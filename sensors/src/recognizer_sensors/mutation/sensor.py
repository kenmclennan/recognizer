import os
import queue
import sys
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from recognizer_sensors.crap.lcov import function_coverage
from recognizer_sensors.findings import render, write_atomically
from recognizer_sensors.functions import find_functions
from recognizer_sensors.identity import assign_identities
from recognizer_sensors.mutation.record import (
    body_hash,
    build_record,
    read_record,
    recorded_verdicts,
    stale_test_reason,
)
from recognizer_sensors.mutation.runner import (
    NUMBERS,
    STOP,
    Mutant,
    Stopped,
    StoppedBeforeMutation,
    copy_repository,
    install_coverage_stop_handler,
    install_stop_handler,
    new_work_folder,
    output_tail,
    remove_stale_work_folders,
    remove_work_folder,
    run_function,
    run_functions,
    run_test_command,
)
from recognizer_sensors.mutation.sites import Site, find_sites
from recognizer_sensors.outcome import Outcome, Overlay
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import MeasurementError, SettingsError, relative_path
from recognizer_sensors.testrun.profiles import mutant_command, selected_command
from recognizer_sensors.testrun.run import (
    LOG,
    collect_coverage,
    collect_coverage_with_tests,
    exit_reason,
    parse_coverage,
    parse_test_command,
)

DEFAULTS = {
    "timeout_factor": 10,
    "overlay": ".recognizer/cache/overlays/mutation.json",
    "survivors": ".recognizer/cache/mutation/survivors.json",
    "record": ".recognizer/cache/mutation/record.json",
    "incremental": True,
}

ALLOWED = {"test_command", "coverage", "max_workers", "max_minutes", *DEFAULTS}

CLOCK = time.monotonic

CHECKPOINT_SECONDS = 30

TIMEOUT_FLOOR = 2.0

METRICS = [
    {"name": "killed", "type": "count", "granularity": "member", "bad": "low"},
    {"name": "survived", "type": "count", "granularity": "member", "bad": "high"},
    {"name": "uncovered", "type": "count", "granularity": "member", "bad": "high"},
    {"name": "score", "type": "ratio", "granularity": "member", "bad": "low"},
]

STALE_OVERLAY = Path(".recognizer") / "cache" / "overlays" / "mutate.json"

PRINCIPLE = "Tests must catch changes"
FIX_PATTERN = "strengthen-tests"


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
    language: str = ""
    covered: list[bool] = field(default_factory=list)
    timeouts: list[Site] = field(default_factory=list)
    selections: list[frozenset[str] | None] = field(default_factory=list)
    verdicts: list[str | None] = field(default_factory=list)
    reused: bool = False


def parse_settings(raw: dict) -> dict:
    unknown = sorted(set(raw) - ALLOWED)

    if unknown:
        raise SettingsError(f"unknown setting: {', '.join(unknown)}")

    command = parse_test_command(raw)
    coverage = parse_coverage(raw)
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

    parsed = {
        "max_minutes": float(budget) if budget is not None else None,
        "incremental": incremental,
        "record": relative_path("record", settings["record"]),
        "timeout_factor": float(factor),
        "max_workers": workers,
        "overlay": relative_path("overlay", settings["overlay"]),
        "survivors": relative_path("survivors", settings["survivors"]),
    }

    if command is not None:
        parsed["test_command"] = command

    if coverage is not None:
        parsed["coverage"] = coverage

    return parsed


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
        Target(
            identity, module, path, qualified, start, end, sites, body=body, language=scan.language
        )
        for identity, (module, path, qualified, start, end, sites, body) in zip(
            identities, pending, strict=True
        )
    ]

    return targets, sources


def covering_line(site: Site, target: Target, lines: dict[int, int] | None) -> int | None:
    if not lines:
        return None

    candidates = [n for n in lines if target.start_line <= n <= site.line]

    return max(candidates) if candidates else None


def site_is_covered(site: Site, target: Target, lines: dict[int, int] | None) -> bool:
    line = covering_line(site, target, lines)

    return line is not None and lines[line] > 0


def timeout_for(baseline_seconds: float, factor: float) -> float:
    return max(TIMEOUT_FLOOR, factor * baseline_seconds)


LOG_LOCK = threading.Lock()


class CopyPool:
    def __init__(self, repository: Path, work: Path, size: int) -> None:
        self.repository = repository
        self.work = work
        self.size = size
        self.lock = threading.Lock()
        self.free: queue.Queue[Path | None] = queue.Queue()
        self.made = 0

    @contextmanager
    def lease(self) -> Iterator[Path]:
        copy = self.take()

        try:
            yield copy
        finally:
            self.free.put(copy)

    def take(self) -> Path:
        while True:
            create = False

            with self.lock:
                try:
                    copy = self.free.get_nowait()

                    if copy is None:
                        continue
                except queue.Empty:
                    copy = None
                    create = self.made < self.size

                    if create:
                        self.made += 1

            if copy is not None:
                return copy

            if not create:
                copy = self.free.get()

                if copy is None:
                    continue

                return copy

            return self.make()

    def make(self) -> Path:
        copy = self.work / f"baseline-{next(NUMBERS)}"

        try:
            copy_repository(self.repository, copy)
        except BaseException:
            with self.lock:
                self.made -= 1

            self.free.put(None)

            raise

        return copy


def run_baseline(repository: Path, copies: CopyPool, command: list[str], subject: str) -> float:
    try:
        with copies.lease() as copy:
            result = run_test_command(command, copy, None)
    except OSError:
        raise MeasurementError(f"{subject} did not start: {command[0]}") from None

    if STOP.is_set():
        raise Stopped

    if result.passed:
        return result.seconds

    log = repository / LOG

    with LOG_LOCK:
        log.parent.mkdir(parents=True, exist_ok=True)

        with log.open("a", encoding="utf-8") as stream:
            stream.write(f"== baseline {' '.join(command)}\n{output_tail(result.output)}\n")

    if result.exit_code is None:
        raise MeasurementError(f"{subject} did not start: {command[0]}")

    raise MeasurementError(exit_reason(subject, result.exit_code, result.output))


class Baseline:
    def __init__(self) -> None:
        self.done = threading.Event()
        self.seconds = 0.0
        self.error: Exception | None = None


class Baselines:
    def __init__(self, repository: Path, work: Path, max_workers: int) -> None:
        self.repository = repository
        self.copies = CopyPool(repository, work, max_workers)
        self.lock = threading.Lock()
        self.entries: dict[tuple[str, ...], Baseline] = {}

    def seconds(self, command: list[str], subject: str, fallback: bool = False) -> float | None:
        key = tuple(command)

        with self.lock:
            entry = self.entries.get(key)
            owner = entry is None

            if entry is None:
                entry = self.entries[key] = Baseline()

        if owner:
            try:
                entry.seconds = run_baseline(self.repository, self.copies, command, subject)
            except Exception as error:
                entry.error = error

                if fallback and not isinstance(error, Stopped):
                    print(
                        f"recognizer-sensors: mutation: {error}; running the whole suite",
                        file=sys.stderr,
                    )
            finally:
                entry.done.set()
        else:
            entry.done.wait()

        if entry.error is None:
            return entry.seconds

        if fallback and not isinstance(entry.error, Stopped):
            return None

        raise entry.error


def site_entry(site: Site) -> dict:
    return {"line": site.line, "operator": site.operator, "replacement": site.replacement}


def survivors_document(
    commit: str, targets: list[Target], skipped: list[str], reused: int, no_covering_test: int
) -> dict:
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
        "unmeasured": {"budget": len(skipped), "no-covering-test": no_covering_test},
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


def commands_for(
    repository: Path, scans: list[Scan], configured: list[str] | None
) -> dict[str, list[str]]:
    return {
        scan.language: configured
        if configured is not None
        else mutant_command(repository, scan.language)
        for scan in scans
    }


def record_key(configured: list[str] | None, commands: dict[str, list[str]]) -> object:
    return configured if configured is not None else {"commands": commands, "selection": 1}


def describe(survivor: dict) -> str:
    if survivor["replacement"] == "":
        return f"line {survivor['line']} {survivor['operator']} removed"

    return f"line {survivor['line']} {survivor['operator']} to {survivor['replacement']}"


def finding_for(target: Target, values: dict) -> dict:
    listed = target.survivors
    noun = "mutation" if len(listed) == 1 else "mutations"
    measures = {name: values[name][target.identity] for name in ("killed", "survived", "uncovered")}

    if target.identity in values["score"]:
        measures["score"] = values["score"][target.identity]

    return {
        "id": f"mutation:{target.identity}",
        "kind": "mutation",
        "severity": "warning",
        "principle": PRINCIPLE,
        "fix_pattern": FIX_PATTERN,
        "summary": (
            f"{target.qualified} in {target.module} has {len(listed)} surviving {noun}: "
            + ", ".join(describe(site_entry(s)) for s in listed)
        ),
        "evidence": {
            "modules": [target.module],
            "members": [
                {
                    "module": target.module,
                    "name": target.qualified,
                    "file": target.file,
                    "lines": [target.start_line, target.end_line],
                }
            ],
            "measures": measures,
        },
    }


def record_for(
    key: object, commit: str, targets: list[Target], queued: set[str], done: set[str]
) -> dict:
    finished = [t for t in targets if t.identity not in queued or t.identity in done]

    return build_record(
        key,
        commit,
        {t.identity: {"body": t.body, "verdicts": t.verdicts} for t in finished},
        sorted(queued - done),
    )


def write_checkpoint(path: Path, record: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(render(record), path)
    except OSError:
        return


def run(repository: Path, scans: list[Scan], settings: dict, commit: str) -> Outcome:
    configured = settings.get("test_command")

    restore_coverage_handler = install_coverage_stop_handler()

    try:
        if configured is None:
            coverage, selection = collect_coverage_with_tests(
                repository, scans, settings.get("coverage")
            )
        else:
            coverage = collect_coverage(repository, scans, None, settings.get("coverage"))
            selection = {}
    except (StoppedBeforeMutation, MeasurementError):
        if not STOP.is_set():
            raise

        return Outcome([], None, [], True, 0, 0)
    finally:
        restore_coverage_handler()

    suite_size = len({f for lines in selection.values() for files in lines.values() for f in files})
    targets: list[Target] = []
    sources: dict[str, bytes] = {}
    no_covering_test = 0

    for scan in scans:
        found, scan_sources = collect_targets(repository, scan)
        sources.update(scan_sources)

        for target in found:
            lines = coverage.get(target.file)
            known = function_coverage(lines, target.start_line, target.end_line)

            if known is None:
                continue

            targets.append(target)
            target.covered = [
                known > 0 and site_is_covered(site, target, lines) for site in target.sites
            ]
            target.uncovered = target.covered.count(False)
            chosen = selection.get(target.file, {})
            target.selections = [
                chosen.get(covering_line(site, target, lines)) if covered else None
                for site, covered in zip(target.sites, target.covered, strict=True)
            ]

            if target.sites and not any(target.covered):
                no_covering_test += 1

    commands = commands_for(repository, scans, configured)
    key = record_key(configured, commands)
    record = read_record(repository / settings["record"], key) if settings["incremental"] else None
    earlier_skipped = record["skipped"] if record else []
    reuse = record

    if record is not None:
        reason = stale_test_reason(repository, record["commit"])

        if reason is not None:
            print(f"recognizer-sensors: mutation: {reason}", file=sys.stderr)
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
    ran = {"selection": 0, "whole": 0}
    done: set[str] = set()
    queued = {target.identity for target in queue}
    stopped = False

    if queue:
        work = new_work_folder(repository)
        remove_stale_work_folders(work)
        labelled = len(commands) > 1
        restore_handler = install_stop_handler(work)

        try:
            baselines = Baselines(repository, work, settings["max_workers"])
            tally_lock = threading.Lock()

            def plan_for(target: Target) -> Callable[[int], tuple[list[str], float]]:
                whole = commands[target.language]
                subject = f"the {target.language} test command" if labelled else "the test command"
                chosen = [
                    selections
                    for selections, covered in zip(target.selections, target.covered, strict=True)
                    if covered
                ]

                def lookup(index: int) -> tuple[list[str], float]:
                    seconds = None
                    command = whole
                    files = chosen[index] if configured is None else None
                    selected = (
                        selected_command(repository, target.language, files)
                        if files and len(files) * 2 <= suite_size
                        else None
                    )

                    if selected is not None and selected != whole:
                        seconds = baselines.seconds(
                            selected, "the selected test command", fallback=True
                        )

                        if seconds is not None:
                            command = selected

                    if seconds is None:
                        seconds = baselines.seconds(whole, subject)

                    with tally_lock:
                        ran["selection" if command is not whole else "whole"] += 1

                    return command, timeout_for(seconds, settings["timeout_factor"])

                return lookup

            budget = settings["max_minutes"]
            started = CLOCK()
            deadline = started + budget * 60 if budget is not None else None
            checkpoint = {"at": started}

            def finish(target: Target, outcome: list[str]) -> None:
                verdicts: list[str | None] = [None] * len(target.sites)

                for (index, _), verdict in zip(covered_sites(target), outcome, strict=True):
                    verdicts[index] = verdict

                apply_verdicts(target, verdicts)
                done.add(target.identity)
                now = CLOCK()

                if now - checkpoint["at"] >= CHECKPOINT_SECONDS:
                    checkpoint["at"] = now
                    write_checkpoint(
                        repository / settings["record"],
                        record_for(key, commit, targets, queued, done),
                    )

            run_functions(
                queue,
                lambda target: run_function(
                    repository, work, mutants_for(target, sources), plan_for(target)
                ),
                settings["max_workers"],
                deadline,
                CLOCK,
                finish,
            )
            stopped = STOP.is_set()
            remove_stale_work_folders(work)
        finally:
            restore_handler()
            remove_work_folder(work)

        skipped = [target for target in queue if target.identity not in done]

    skipped_ids = [target.identity for target in skipped]
    skipped_set = set(skipped_ids)
    measured = [target for target in targets if target.identity not in skipped_set]
    reused = sum(1 for target in measured if target.reused)
    mutated = len(measured) - reused

    print(
        f"recognizer-sensors: mutation: {reused} of {len(targets)} functions reused, "
        f"{mutated} mutated, {len(skipped_ids)} skipped (uncovered-by-budget)",
        file=sys.stderr,
    )
    print(
        f"recognizer-sensors: mutation: {no_covering_test} functions without a covering test; "
        f"{ran['selection']} mutants ran a selection, {ran['whole']} ran the whole suite",
        file=sys.stderr,
    )

    values = overlay_values(measured)
    overlay = Overlay(METRICS, values, repository / settings["overlay"])
    record_document = record_for(key, commit, targets, queued, done)
    documents = [
        (
            repository / settings["survivors"],
            survivors_document(commit, measured, skipped_ids, reused, no_covering_test),
        ),
        (repository / settings["record"], record_document),
    ]
    findings = [finding_for(t, values) for t in measured if t.survived > 0]
    (repository / STALE_OVERLAY).unlink(missing_ok=True)

    return Outcome(findings, overlay, documents, stopped, len(measured), len(targets))
