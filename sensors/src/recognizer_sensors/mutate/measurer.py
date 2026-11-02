import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from recognizer_sensors.crap.lcov import read_lcov
from recognizer_sensors.functions import find_functions
from recognizer_sensors.identity import assign_identities
from recognizer_sensors.mutate.record import (
    body_hash,
    build_record,
    read_record,
    recorded_verdicts,
    stale_test_reason,
)
from recognizer_sensors.mutate.runner import (
    Mutant,
    copy_repository,
    new_work_folder,
    output_tail,
    remove_stale_work_folders,
    remove_work_folder,
    run_function,
    run_functions,
    run_test_command,
)
from recognizer_sensors.mutate.sites import Site, find_sites
from recognizer_sensors.outcome import Measurement, Overlay
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import MeasurementError, SettingsError, relative_path

DEFAULTS = {
    "timeout_factor": 10,
    "coverage": "coverage/lcov.info",
    "crap_overlay": ".recognizer/cache/overlays/crap.json",
    "survivors": ".recognizer/cache/mutation/survivors.json",
    "record": ".recognizer/cache/mutation/record.json",
    "incremental": True,
}

ALLOWED = {"test_command", "max_workers", "max_minutes", *DEFAULTS}

CLOCK = time.monotonic

TIMEOUT_FLOOR = 2.0

METRICS = [
    {"name": "killed", "type": "count", "granularity": "member", "bad": "low"},
    {"name": "survived", "type": "count", "granularity": "member", "bad": "high"},
    {"name": "uncovered", "type": "count", "granularity": "member", "bad": "high"},
    {"name": "score", "type": "ratio", "granularity": "member", "bad": "low"},
]

OVERLAY_PATH = Path(".recognizer") / "cache" / "overlays" / "mutate.json"


@dataclass
class Target:
    identity: str
    module: str
    file: str
    qualified: str
    start_line: int
    end_line: int
    sites: list[Site] = field(default_factory=list)
    killed: int = 0
    survived: int = 0
    uncovered: int = 0
    survivors: list[Site] = field(default_factory=list)
    body: str = ""
    covered: list[bool] = field(default_factory=list)
    timeouts: list[Site] = field(default_factory=list)
    verdicts: list[str | None] = field(default_factory=list)
    reused: bool = False


def parse_settings(raw: dict) -> dict:
    unknown = sorted(set(raw) - ALLOWED)

    if unknown:
        raise SettingsError(f"unknown setting: {', '.join(unknown)}")

    command = raw.get("test_command")

    if (
        not isinstance(command, list)
        or not command
        or not all(isinstance(item, str) and item for item in command)
    ):
        raise SettingsError("test_command must be a non-empty array of non-empty strings")

    settings = {**DEFAULTS, **raw}
    factor = settings["timeout_factor"]

    if isinstance(factor, bool) or not isinstance(factor, int | float):
        raise SettingsError("timeout_factor must be a number")

    if not factor > 0:
        raise SettingsError("timeout_factor must be above 0")

    workers = settings.get("max_workers", os.cpu_count() or 1)

    if isinstance(workers, bool) or not isinstance(workers, int):
        raise SettingsError("max_workers must be an integer")

    if workers < 1:
        raise SettingsError("max_workers must be at least 1")

    incremental = settings["incremental"]

    if not isinstance(incremental, bool):
        raise SettingsError("incremental must be true or false")

    budget = settings.get("max_minutes")

    if budget is not None:
        if isinstance(budget, bool) or not isinstance(budget, int | float):
            raise SettingsError("max_minutes must be a number")

        if not budget > 0:
            raise SettingsError("max_minutes must be above 0")

    return {
        "test_command": list(command),
        "max_minutes": float(budget) if budget is not None else None,
        "incremental": incremental,
        "record": relative_path("record", settings["record"]),
        "timeout_factor": float(factor),
        "max_workers": workers,
        "coverage": relative_path("coverage", settings["coverage"]),
        "crap_overlay": relative_path("crap_overlay", settings["crap_overlay"]),
        "survivors": relative_path("survivors", settings["survivors"]),
    }


def read_known_coverage(repository: Path, setting: str, commit: str) -> dict[str, float]:
    advice = f"run recognizer scan --sense crap first: {setting}"

    try:
        document = json.loads((repository / setting).read_text(encoding="utf-8"))
        names = [metric["name"] for metric in document["metrics"]]
        values = document["values"]["coverage"]
        document_commit = document["commit"]
    except (OSError, ValueError, KeyError, TypeError):
        raise MeasurementError(f"CRAP overlay is missing or unreadable; {advice}") from None

    if "coverage" not in names or not isinstance(values, dict):
        raise MeasurementError(f"CRAP overlay has no coverage metric; {advice}")

    if document_commit != commit:
        raise MeasurementError(f"CRAP overlay is from another commit; {advice}")

    return {
        key: float(value)
        for key, value in values.items()
        if isinstance(value, int | float) and not isinstance(value, bool)
    }


def innermost(sites: list[Site], spans: list[tuple[int, int]]) -> dict[int, list[Site]]:
    owned: dict[int, list[Site]] = {}

    for site in sites:
        enclosing = [
            index
            for index, (start, end) in enumerate(spans)
            if start <= site.start_byte and site.end_byte <= end
        ]

        if enclosing:
            best = min(enclosing, key=lambda index: spans[index][1] - spans[index][0])
            owned.setdefault(best, []).append(site)

    return owned


def collect_targets(repository: Path, scan: Scan) -> tuple[list[Target], dict[str, bytes]]:
    pending: list[tuple[str, str, str, int, int, list[Site], str]] = []
    sources: dict[str, bytes] = {}

    for module in scan.modules:
        for path in module.files:
            grammar = grammar_for(path)

            if grammar is None:
                continue

            try:
                source = (repository / path).read_bytes()
            except OSError:
                continue

            sources[path] = source
            root = parse(grammar, source).root_node
            found = [f for f in find_functions(root, grammar) if not f.node.has_error]
            spans = [(f.node.start_byte, f.node.end_byte) for f in found]
            owned = innermost(find_sites(root, grammar), spans)

            for index, function in enumerate(found):
                node = function.node
                pending.append(
                    (
                        module.id,
                        path,
                        function.qualified,
                        node.start_point[0] + 1,
                        node.end_point[0] + 1,
                        owned.get(index, []),
                        body_hash(source[node.start_byte : node.end_byte]),
                    )
                )

    identities = assign_identities([(m, q, start) for m, _, q, start, _, _, _ in pending])
    targets = [
        Target(identity, module, path, qualified, start, end, sites, body=body)
        for identity, (module, path, qualified, start, end, sites, body) in zip(
            identities, pending, strict=True
        )
    ]

    return targets, sources


def site_is_covered(site: Site, target: Target, lines: dict[int, int] | None) -> bool:
    if not lines:
        return False

    candidates = [n for n in lines if target.start_line <= n <= site.line]

    return bool(candidates) and lines[max(candidates)] > 0


def timeout_for(baseline_seconds: float, factor: float) -> float:
    return max(TIMEOUT_FLOOR, factor * baseline_seconds)


def run_baseline(repository: Path, work: Path, command: list[str]) -> float:
    copy = work / "baseline"

    try:
        copy_repository(repository, copy)
        result = run_test_command(command, copy, None)
    except OSError as error:
        raise MeasurementError(f"baseline test run failed (did not start: {error})") from None

    if result.passed:
        return result.seconds

    state = "did not start" if result.exit_code is None else f"exit {result.exit_code}"

    raise MeasurementError(f"baseline test run failed ({state})\n{output_tail(result.output)}")


def site_entry(site: Site) -> dict:
    return {"line": site.line, "operator": site.operator, "replacement": site.replacement}


def survivors_document(commit: str, targets: list[Target], skipped: list[str], reused: int) -> dict:
    functions = {
        target.identity: {
            "module": target.module,
            "name": target.qualified,
            "file": target.file,
            "lines": [target.start_line, target.end_line],
            "survivors": [site_entry(s) for s in target.survivors],
            "timeouts": [site_entry(s) for s in target.timeouts],
        }
        for target in sorted(targets, key=lambda t: t.identity)
        if target.survivors or target.timeouts
    }

    return {
        "survivors_version": 1,
        "commit": commit,
        "complete": not skipped,
        "reused": reused,
        "skipped": [
            {"identity": identity, "reason": "uncovered-by-budget"} for identity in sorted(skipped)
        ],
        "functions": functions,
    }


def overlay_values(targets: list[Target]) -> dict[str, dict[str, float]]:
    values: dict[str, dict[str, float]] = {m["name"]: {} for m in METRICS}

    for target in targets:
        values["killed"][target.identity] = target.killed
        values["survived"][target.identity] = target.survived
        values["uncovered"][target.identity] = target.uncovered
        ran = target.killed + target.survived

        if ran > 0:
            values["score"][target.identity] = round(target.killed / ran, 4)

    return values


def covered_sites(target: Target) -> list[tuple[int, Site]]:
    return [(index, site) for index, site in enumerate(target.sites) if target.covered[index]]


def apply_verdicts(target: Target, verdicts: list[str | None]) -> None:
    target.verdicts = list(verdicts)

    for site, verdict in zip(target.sites, verdicts, strict=True):
        if verdict is None:
            continue

        if verdict == "survived":
            target.survived += 1
            target.survivors.append(site)
        else:
            target.killed += 1

            if verdict == "timeout":
                target.timeouts.append(site)


def reusable(target: Target, record: dict | None) -> list[str | None] | None:
    if record is None:
        return None

    verdicts = recorded_verdicts(record, target.identity, target.body)

    if verdicts is None or len(verdicts) != len(target.sites):
        return None

    recorded = [verdict is not None for verdict in verdicts]

    return verdicts if recorded == target.covered else None


def mutants_for(target: Target, sources: dict[str, bytes]) -> list[Mutant]:
    return [
        Mutant(
            target.file,
            sources[target.file],
            site.start_byte,
            site.end_byte,
            site.replacement.encode("utf-8"),
        )
        for _, site in covered_sites(target)
    ]


def queue_order(pending: list[Target], skipped: list[str]) -> list[Target]:
    earlier = set(skipped)

    return sorted(pending, key=lambda t: (t.identity not in earlier, t.identity))


def run(
    repository: Path, scans: list[Scan], settings: dict, commit: str, modified: bool
) -> Measurement:
    started = CLOCK()
    known = read_known_coverage(repository, settings["crap_overlay"], commit)
    coverage = read_lcov(repository / settings["coverage"], repository)

    if coverage is None:
        raise MeasurementError(f"coverage file {settings['coverage']} is missing or unreadable")

    targets: list[Target] = []
    sources: dict[str, bytes] = {}

    for scan in scans:
        found, scan_sources = collect_targets(repository, scan)
        sources.update(scan_sources)

        for target in found:
            if target.identity not in known:
                continue

            targets.append(target)
            lines = coverage.get(target.file)
            target.covered = [
                known[target.identity] > 0 and site_is_covered(site, target, lines)
                for site in target.sites
            ]
            target.uncovered = target.covered.count(False)

    command = settings["test_command"]
    record = (
        read_record(repository / settings["record"], command) if settings["incremental"] else None
    )
    earlier_skipped = record["skipped"] if record else []
    reuse = record

    if record is not None:
        reason = stale_test_reason(repository, record["commit"])

        if reason is not None:
            print(f"recognizer-sensors: mutate: {reason}", file=sys.stderr)
            reuse = None

    pending: list[Target] = []

    for target in targets:
        verdicts = reusable(target, reuse)

        if verdicts is not None:
            target.reused = True
            apply_verdicts(target, verdicts)
        elif any(target.covered):
            pending.append(target)
        else:
            apply_verdicts(target, [None] * len(target.sites))

    queue = queue_order(pending, earlier_skipped)
    skipped: list[Target] = []

    if queue:
        work = new_work_folder(repository)
        remove_stale_work_folders(work)

        try:
            baseline = run_baseline(repository, work, command)
            timeout = timeout_for(baseline, settings["timeout_factor"])
            budget = settings["max_minutes"]
            deadline = started + budget * 60 if budget is not None else None
            results = run_functions(
                queue,
                lambda target: run_function(
                    repository, work, mutants_for(target, sources), command, timeout
                ),
                settings["max_workers"],
                deadline,
                CLOCK,
            )
            remove_stale_work_folders(work)
        finally:
            remove_work_folder(work)

        for target, outcome in zip(queue, results, strict=True):
            if outcome is None:
                skipped.append(target)
                continue

            verdicts: list[str | None] = [None] * len(target.sites)

            for (index, _), verdict in zip(covered_sites(target), outcome, strict=True):
                verdicts[index] = verdict

            apply_verdicts(target, verdicts)

    skipped_ids = [target.identity for target in skipped]
    skipped_set = set(skipped_ids)
    measured = [target for target in targets if target.identity not in skipped_set]
    reused = sum(1 for target in measured if target.reused)
    mutated = len(measured) - reused

    print(
        f"recognizer-sensors: mutate: {reused} of {len(targets)} functions reused, "
        f"{mutated} mutated, {len(skipped_ids)} skipped (uncovered-by-budget)",
        file=sys.stderr,
    )

    overlay = Overlay(METRICS, overlay_values(measured), repository / OVERLAY_PATH)
    document = build_record(
        command,
        commit,
        {t.identity: {"body": t.body, "verdicts": t.verdicts} for t in measured},
        sorted(skipped_ids),
    )

    return Measurement(overlay, survivors_document(commit, measured, skipped_ids, reused), document)
