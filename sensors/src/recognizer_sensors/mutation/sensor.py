import queue
import sys
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

from recognizer_sensors.crap.lcov import function_coverage
from recognizer_sensors.findings import render, write_atomically
from recognizer_sensors.functions import find_functions
from recognizer_sensors.hashes import (
    digest_of,
    listed_files,
    rust_test_entries,
    scan_hashes,
    support_hash,
    test_hashes,
)
from recognizer_sensors.identity import assign_identities
from recognizer_sensors.mutation.commands import RUST_UNITS, mutant_command, selected_command
from recognizer_sensors.mutation.inline_tests import unit_test_hashes
from recognizer_sensors.mutation.memory import available_bytes, core_count, default_workers
from recognizer_sensors.mutation.record import (
    body_hash,
    build_record,
    held_entry,
    read_record,
    recorded_entry,
    site_reusable,
    with_conftests,
)
from recognizer_sensors.mutation.runner import (
    BUDGET_SPENT,
    NUMBERS,
    STOP,
    Mutant,
    MutantCopies,
    MutantResult,
    PeakSampler,
    Stopped,
    StoppedBeforeMutation,
    copy_repository,
    git_lines,
    install_coverage_stop_handler,
    install_stop_handler,
    new_work_folder,
    output_tail,
    remove_stale_work_folders,
    remove_work_folder,
    run_function,
    run_functions,
    run_test_command,
    watch_budget,
)
from recognizer_sensors.mutation.sites import Site, find_sites
from recognizer_sensors.mutation.warmup import CARRY_HINT, coverage_run
from recognizer_sensors.mutation.warmup import suite_size as suite_size_of
from recognizer_sensors.outcome import Outcome, Overlay
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.principles import principle_fields
from recognizer_sensors.progress import report
from recognizer_sensors.rust_test_blocks import in_file_test_hashes
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import (
    MeasurementError,
    Refusal,
    SettingsError,
    diagnose,
    relative_path,
)
from recognizer_sensors.testrun.failures import log_names, mutation_tests_failed, not_installed
from recognizer_sensors.testrun.records import (
    composed_tests,
    merged_entries,
    new_entry,
    read_entries,
    record_document,
    record_path,
    recorded_inputs,
    suites_array,
    tests_owned_by,
)
from recognizer_sensors.testrun.suites import Suite, directory_of, owner_of, parse_suites, selected

NO_AFFECTED = "No affected test files found"

DEFAULTS = {
    "timeout_factor": 10,
    "overlay": ".recognizer/cache/overlays/mutation.json",
    "survivors": ".recognizer/cache/mutation/survivors.json",
    "record": ".recognizer/cache/mutation/record.json",
    "incremental": True,
}

ALLOWED = {"tests", "max_workers", "max_minutes", "carry", *DEFAULTS}

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
    nodes: list[frozenset[str] | None] = field(default_factory=list)
    previous: dict[int, frozenset[str]] = field(default_factory=dict)
    verdicts: list[str | None] = field(default_factory=list)
    covers: list[frozenset[str] | None] = field(default_factory=list)
    to_run: list[int] = field(default_factory=list)
    kept: dict[int, tuple[str, dict]] = field(default_factory=dict)
    entries: list[dict | None] = field(default_factory=list)
    reused: bool = False
    carried: bool = False
    suite: str = ""
    held: dict | None = None


def parse_carry(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise SettingsError("carry must be a list of paths")

    for item in value:
        if not isinstance(item, str):
            raise SettingsError("carry entries must be strings")

        if item.startswith("/") or Path(item).is_absolute() or ".." in Path(item).parts:
            raise SettingsError(
                f"carry entry must be a relative path inside the repository: {item}"
            )

    return tuple(item.rstrip("/") for item in value if item.rstrip("/"))


def parse_settings(raw: dict) -> dict:
    unknown = sorted(set(raw) - ALLOWED)

    if unknown:
        raise SettingsError(f"unknown setting: {', '.join(unknown)}")

    suites = [asdict(s) for s in parse_suites(raw["tests"])] if "tests" in raw else None
    settings = {**DEFAULTS, **raw}
    factor = settings["timeout_factor"]

    if isinstance(factor, bool) or not isinstance(factor, int | float):
        raise SettingsError("timeout_factor must be a number")

    if not factor > 0:
        raise SettingsError("timeout_factor must be above 0")

    workers = settings.get("max_workers")

    if workers is not None:
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

    seen: set[tuple[str, str]] = set()

    for item in suites or []:
        key = (item["language"], directory_of(Suite(**item)))

        if key in seen:
            raise SettingsError(
                f"two test suites run {key[0]} from {key[1] or '.'}; "
                "Mutation cannot tell them apart"
            )

        seen.add(key)

    carry = parse_carry(settings.get("carry", []))

    if carry:
        parsed["carry"] = carry

    parsed["suites"] = suites

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

BASELINE_LOG = Path(".recognizer") / "cache" / "mutation" / "baseline.log"


class CopyPool:
    def __init__(
        self, repository: Path, work: Path, size: int, carry: tuple[str, ...] = ()
    ) -> None:
        self.carry = carry
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
            if self.carry:
                copy_repository(self.repository, copy, self.carry)
            else:
                copy_repository(self.repository, copy)
        except BaseException:
            with self.lock:
                self.made -= 1

            self.free.put(None)

            raise

        return copy


class NoSelectedTests(Exception):
    pass


class BaselineTimedOut(Exception):
    pass


def omitted_paths(repository: Path, carry: tuple[str, ...]) -> list[str]:
    listed = git_lines(repository, "--others", "--ignored", "--exclude-standard", "--directory")

    return [
        path
        for path in listed or []
        if path.rstrip("/") not in carry
        and path.rstrip("/") != ".git"
        and not path.startswith(".recognizer/cache")
    ]


def run_baseline(
    repository: Path,
    copies: CopyPool,
    command: list[str] | str,
    subject: str,
    suite: Suite,
    limit: float | None = None,
) -> float:
    with copies.lease() as copy:
        result = run_test_command(command, copy, limit, suite=suite)

    carry = copies.carry

    if STOP.is_set() or BUDGET_SPENT.is_set():
        raise Stopped

    if result.timed_out:
        raise BaselineTimedOut(f"the baseline passed its {limit:.0f} second bound")

    if result.passed and NO_AFFECTED in result.output:
        raise NoSelectedTests("no affected test files found")

    if result.passed:
        return result.seconds

    log = repository / BASELINE_LOG
    omitted = omitted_paths(repository, carry)

    with LOG_LOCK:
        log.parent.mkdir(parents=True, exist_ok=True)

        with log.open("a", encoding="utf-8") as stream:
            stream.write(f"== baseline {command_text(command)}\n{output_tail(result.output)}\n")
            stream.write(f"== omitted from the copy: {', '.join(omitted) or 'none'}\n")

    print(CARRY_HINT, file=sys.stderr)

    if result.exit_code is None:
        raise not_installed(command.split()[0] if isinstance(command, str) else command[0])

    raise Refusal(mutation_tests_failed(log_names(None, result.output)))


def command_text(command: list[str] | str) -> str:
    return command if isinstance(command, str) else " ".join(command)


def baseline_key(suite: Suite, command: list[str] | str) -> tuple[str, ...]:
    return (suite.name, command) if isinstance(command, str) else (suite.name, *command)


class Baseline:
    def __init__(self) -> None:
        self.done = threading.Event()
        self.seconds = 0.0
        self.error: Exception | None = None


class Baselines:
    def __init__(
        self,
        repository: Path,
        work: Path,
        max_workers: int,
        carry: tuple[str, ...] = (),
    ) -> None:
        self.repository = repository
        self.copies = CopyPool(repository, work, max_workers, carry)
        self.lock = threading.Lock()
        self.entries: dict[tuple[str, ...], Baseline] = {}

    def prime(self, command: list[str] | str, suite: Suite, seconds: float) -> None:
        entry = Baseline()
        entry.seconds = seconds
        entry.done.set()

        with self.lock:
            self.entries[baseline_key(suite, command)] = entry

    def recorded(self, command: list[str] | str, suite: Suite) -> float | None:
        with self.lock:
            entry = self.entries.get(baseline_key(suite, command))

        if entry is None or not entry.done.is_set() or entry.error is not None:
            return None

        return entry.seconds

    def seconds(
        self,
        command: list[str] | str,
        subject: str,
        suite: Suite,
        fallback: bool = False,
        limit: float | None = None,
    ) -> float | None:
        key = baseline_key(suite, command)

        with self.lock:
            entry = self.entries.get(key)
            owner = entry is None

            if entry is None:
                entry = self.entries[key] = Baseline()

        if owner:
            try:
                entry.seconds = run_baseline(
                    self.repository, self.copies, command, subject, suite, limit
                )
            except Exception as error:
                entry.error = error

                if fallback and not isinstance(error, Stopped):
                    print(
                        f"recognizer-sensors: mutation: {subject}: {error};"
                        " running the whole suite",
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
    commit: str,
    targets: list[Target],
    skipped: list[str],
    reused: int,
    no_covering_test: int,
    excluded: list[Target] | None = None,
    no_line: list[Target] | None = None,
    unowned: list[Target] | None = None,
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
        "excluded": [
            {
                "identity": target.identity,
                "file": target.file,
                "reason": "not-in-coverage-report",
            }
            for target in sorted(excluded or [], key=lambda t: t.identity)
        ],
        "unowned": [
            {
                "identity": target.identity,
                "file": target.file,
                "reason": "no-owning-suite",
            }
            for target in sorted(unowned or [], key=lambda t: t.identity)
        ],
        "no_executable_line": [
            {
                "identity": target.identity,
                "file": target.file,
                "reason": "no-executable-line",
            }
            for target in sorted(no_line or [], key=lambda t: t.identity)
        ],
        "functions": functions,
    }


def excluded_document(excluded: list[Target]) -> dict | None:
    if not excluded:
        return None

    return {
        "functions": len(excluded),
        "modules": sorted({target.module for target in excluded}),
    }


def unowned_document(unowned: list[Target]) -> dict | None:
    return excluded_document(unowned)


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


def cover_of(files: frozenset[str] | None, hashes: dict[str, str]) -> frozenset[str] | None:
    if not files or any(path not in hashes for path in files):
        return None

    return with_conftests(files, hashes)


def node_set_for(
    nodes: frozenset[str] | None, files: frozenset[str] | None
) -> frozenset[str] | None:
    if not nodes or not files:
        return None

    return nodes if {node.split("::", 1)[0] for node in nodes} == set(files) else None


def shared_cover(
    files: frozenset[str] | None,
    hashes: dict[str, str],
    known: dict[frozenset[str], frozenset[str] | None],
) -> frozenset[str] | None:
    if files is None:
        return None

    if files not in known:
        known[files] = cover_of(files, hashes)

    return known[files]


def kept_sites(
    target: Target, record: dict | None, hashes: dict[str, str], tests: str, support: str
) -> dict[int, tuple[str, dict]] | None:
    entry = recorded_entry(record, target.identity, target.body, support)

    if entry is None or len(entry["verdicts"]) != len(target.sites):
        return None

    kept: dict[int, tuple[str, dict]] = {}

    for index, covered in enumerate(target.covered):
        verdict = entry["verdicts"][index]
        site = entry["sites"][index]

        if (
            covered
            and verdict is not None
            and site_reusable(verdict, site, hashes, tests, target.covers[index])
        ):
            kept[index] = (verdict, site)

    return kept


def previous_killers(
    record: dict | None, target: Target, support: str
) -> dict[int, frozenset[str]]:
    entry = recorded_entry(record, target.identity, target.body, support)

    if entry is None or len(entry["sites"]) != len(target.sites):
        return {}

    pooled: dict[int, frozenset[str]] = {}
    killers: dict[int, frozenset[str]] = {}

    for index, site in enumerate(entry["sites"]):
        if isinstance(site, dict) and site.get("killer"):
            killer = site["killer"]

            if id(killer) not in pooled:
                pooled[id(killer)] = frozenset(killer)

            killers[index] = pooled[id(killer)]

    return killers


def site_entry_for(
    result: MutantResult,
    cover: frozenset[str] | None,
    hashes: dict[str, str],
    tests: str,
) -> dict:
    if cover is None:
        return {"ran": None, "killer": None, "tests": tests}

    ran = {path: hashes[path] for path in sorted(cover)}

    if result.verdict == "survived":
        killer = None
    elif result.verdict == "timeout" or result.failed is None:
        killer = ran
    else:
        failed = with_conftests(result.failed, hashes)
        killer = {path: hashes[path] for path in sorted(failed)}

    return {"ran": ran, "killer": killer}


def settle(
    target: Target,
    results: dict[int, MutantResult],
    hashes: dict[str, str],
    tests: str,
) -> None:
    verdicts: list[str | None] = [None] * len(target.sites)
    entries: list[dict | None] = [None] * len(target.sites)

    for index, (verdict, site) in target.kept.items():
        verdicts[index] = verdict
        entries[index] = site

    for index, result in results.items():
        verdicts[index] = result.verdict
        entries[index] = site_entry_for(result, target.covers[index], hashes, tests)

    apply_verdicts(target, verdicts)
    target.entries = entries


def mutants_for(target: Target, sources: dict[str, bytes]) -> list[Mutant]:
    return [
        Mutant(
            target.file,
            sources[target.file],
            target.sites[index].start_byte,
            target.sites[index].end_byte,
            target.sites[index].replacement.encode("utf-8"),
        )
        for index in target.to_run
    ]


def queue_order(
    pending: list[Target], skipped: list[str], order: dict[str, int] | None = None
) -> list[Target]:
    earlier = set(skipped)
    ranked = sorted(pending, key=lambda t: (t.identity not in earlier, t.identity))

    if order is None:
        return ranked

    return sorted(ranked, key=lambda t: order.get(t.suite, len(order)))


def record_key(suites: list[dict]) -> object:
    return {"suites": suites, "selection": 3}


def owner_suite(suites: list[Suite], file: str) -> Suite | None:
    return owner_of(suites, file)


def no_suites(languages: list[str]) -> Refusal:
    return Refusal(
        diagnose(
            "coverage-unavailable",
            f"coverage unavailable: no test suite is configured for {', '.join(languages)}",
        )
    )


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
        **principle_fields("mutation-testing"),
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
    key: object,
    commit: str,
    support: str,
    targets: list[Target],
    queued: set[str],
    done: set[str],
    unmeasured: dict[str, bool] | None = None,
    previous: dict | None = None,
) -> dict:
    absent = unmeasured or {}
    finished = [
        t
        for t in targets
        if t.identity not in absent and (t.identity not in queued or t.identity in done)
    ]
    previously_skipped = [identity for identity, was_skipped in absent.items() if was_skipped]

    functions = {
        t.identity: {"body": t.body, "verdicts": t.verdicts, "sites": t.entries} for t in finished
    }

    for target in targets:
        if target.identity in absent or target.identity not in queued - done:
            continue

        carried = recorded_entry(previous, target.identity, target.body, support)

        if carried is not None:
            functions[target.identity] = carried

    for target in targets:
        if target.held is not None:
            functions[target.identity] = target.held

    return build_record(
        key,
        commit,
        support,
        functions,
        sorted((queued - done) | set(previously_skipped)),
    )


def write_checkpoint(path: Path, record: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(render(record), path)
    except OSError:
        return


def run(
    repository: Path,
    scans: list[Scan],
    settings: dict,
    commit: str,
    modules: set[str] | None = None,
    checkpoint: Callable[[Outcome], None] | None = None,
    names: list[str] | None = None,
) -> Outcome:
    raw_suites = settings.get("suites")

    if raw_suites is None:
        raise Refusal(
            diagnose(
                "coverage-unavailable",
                "coverage unavailable: no test suites are configured; "
                "add a tests list to .recognizer/config.yaml",
            )
        )

    suites = [Suite(**item) for item in raw_suites]
    unconfigured = [
        scan.language for scan in scans if not any(s.language == scan.language for s in suites)
    ]

    if scans and len(unconfigured) == len(scans):
        raise no_suites(unconfigured)

    for language in unconfigured:
        print(
            f"recognizer-sensors: mutation: no test suite is configured for {language}; "
            "its files are not measured",
            file=sys.stderr,
        )

    work = new_work_folder(repository)

    try:
        remove_stale_work_folders(work)

        return measure(
            repository,
            [scan for scan in scans if scan.language not in unconfigured],
            settings,
            commit,
            suites,
            work,
            modules,
            checkpoint,
            [scan for scan in scans if scan.language in unconfigured],
            names,
        )
    finally:
        remove_work_folder(work)


def sized_workers(peak: int) -> tuple[int, str]:
    cpus = core_count()
    available = available_bytes()
    workers = default_workers(cpus, available, peak)

    detail = (
        "available memory unreadable"
        if available is None
        else f"cores {cpus}, available {available // 1_000_000} MB, one run {peak // 1_000_000} MB"
    )

    return workers, f"recognizer-sensors: mutation: workers: {workers} ({detail})"


def measure(
    repository: Path,
    scans: list[Scan],
    settings: dict,
    commit: str,
    suites: list[Suite],
    work: Path,
    modules: set[str] | None,
    checkpoint: Callable[[Outcome], None] | None,
    unsuited: list[Scan],
    names: list[str] | None = None,
) -> Outcome:
    restore_coverage_handler = install_coverage_stop_handler()

    ticked = {suite.name for suite in selected(suites, names)}
    stored_entries = read_entries(repository, "mutation")
    warmup_seconds: dict[str, float] = {}

    try:
        with PeakSampler() as sampler:
            coverage, selection = coverage_run(
                repository,
                scans,
                suites,
                work,
                seconds=warmup_seconds,
                names=names,
                **({"carry": settings["carry"]} if "carry" in settings else {}),
            )
    except (StoppedBeforeMutation, MeasurementError):
        if not STOP.is_set():
            raise

        return Outcome([], None, [], True, 0, 0)
    finally:
        restore_coverage_handler()

    sizing_line = None

    if settings["max_workers"] is None:
        workers, sizing_line = sized_workers(sampler.peak_bytes)
        settings = {**settings, "max_workers": workers}

    rust_entries = rust_test_entries(repository)
    test_files = test_hashes(repository, scans, rust_entries)
    support = support_hash(test_files, rust_entries)
    hashes = {**test_files, **unit_test_hashes(repository, RUST_UNITS)}
    tests = digest_of(hashes)
    shared_map = {**test_files, **in_file_test_hashes(repository, listed_files(repository))}
    shared_tests = composed_tests(shared_map, suites, ticked, stored_entries)
    current_modules = scan_hashes([*scans, *unsuited])
    suite_size = suite_size_of(selection)
    targets: list[Target] = []
    excluded: list[Target] = []
    no_line: list[Target] = []
    unowned: list[Target] = []
    covers_by_selection: dict[frozenset[str], frozenset[str] | None] = {}
    sources: dict[str, bytes] = {}
    no_covering_test = 0

    by_name = {suite.name: suite for suite in suites}

    for scan in [*scans, *unsuited]:
        found, scan_sources = collect_targets(repository, scan)
        sources.update(scan_sources)
        language_suites = [suite for suite in suites if suite.language == scan.language]

        for target in found:
            owner = owner_suite(language_suites, target.file)

            if owner is None:
                unowned.append(target)
                continue

            target.suite = owner.name

            if owner.name not in ticked:
                targets.append(target)
                continue

            lines = coverage.get(target.file)

            if lines is None:
                excluded.append(target)
                continue

            known = function_coverage(lines, target.start_line, target.end_line)

            if known is None:
                no_line.append(target)
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
            node_lines = selection.nodes(target.file) if hasattr(selection, "nodes") else {}
            target.nodes = [
                node_set_for(node_lines.get(covering_line(site, target, lines)), files)
                if covered
                else None
                for site, covered, files in zip(
                    target.sites, target.covered, target.selections, strict=True
                )
            ]
            target.covers = [
                shared_cover(files, hashes, covers_by_selection) for files in target.selections
            ]

            if target.sites and not any(target.covered):
                no_covering_test += 1

    key = record_key(settings["suites"])
    record = read_record(repository / settings["record"], key)
    reuse = record if settings["incremental"] else None
    earlier_skipped = reuse["skipped"] if reuse else []
    pending: list[Target] = []
    unmeasured: dict[str, bool] = {}
    carry_skipped = set(record["skipped"]) if record and modules is not None else set()

    for target in targets:
        if target.suite not in ticked:
            entry = held_entry(record, target.identity, len(target.sites))

            if entry is None:
                unmeasured[target.identity] = bool(record) and target.identity in set(
                    record["skipped"]
                )
                continue

            target.held = entry
            target.carried = True
            target.covered = [verdict is not None for verdict in entry["verdicts"]]
            target.uncovered = target.covered.count(False)
            apply_verdicts(target, list(entry["verdicts"]))
            target.entries = list(entry["sites"])

            continue

        out_of_scope = modules is not None and target.module not in modules
        kept = kept_sites(target, record if out_of_scope else reuse, hashes, tests, support)
        wanted = [index for index, covered in enumerate(target.covered) if covered]

        if out_of_scope:
            if kept is None or len(kept) != len(wanted):
                unmeasured[target.identity] = target.identity in carry_skipped
                continue

            target.carried = True

        target.kept = kept or {}
        target.to_run = [index for index in wanted if index not in target.kept]
        target.previous = previous_killers(record, target, support)

        if target.to_run:
            pending.append(target)
        else:
            target.reused = kept is not None
            settle(target, {}, hashes, tests)

    order = {suite.name: position for position, suite in enumerate(suites)}
    queue = queue_order(pending, earlier_skipped, order)
    ran = {"selection": 0, "whole": 0}
    done: set[str] = set()
    queued = {target.identity for target in queue}
    stopped = False
    refused: Refusal | None = None
    ran_suites = [
        suite
        for suite in suites
        if suite.name in ticked and any(scan.language == suite.language for scan in scans)
    ]

    def in_scope(target: Target) -> bool:
        return target.suite in ticked and (modules is None or target.module in modules)

    suite_total = {
        suite.name: sum(1 for t in targets if t.suite == suite.name and in_scope(t))
        for suite in ran_suites
    }
    waiting: dict[str, int] = {}

    for target in queue:
        waiting[target.suite] = waiting.get(target.suite, 0) + 1

    suite_done = {name: suite_total[name] - waiting.get(name, 0) for name in suite_total}

    def announce(name: str) -> None:
        report("mutants", suite_done[name], suite_total[name], name)

    if queue:
        announce(queue[0].suite)
    else:
        for name in suite_total:
            announce(name)

    def suites_result(
        done: set[str], skipped_set: set[str], refused: Refusal | None
    ) -> tuple[list[dict], dict[str, dict]]:
        fresh: dict[str, dict] = {}
        failed_suite = refused.diagnosis.get("suite") if refused is not None else None

        for suite in ran_suites:
            scoped = [t for t in targets if t.suite == suite.name and in_scope(t)]
            skipped_here = sum(1 for t in scoped if t.identity in skipped_set)
            measured_here = (
                len(scoped) - skipped_here - sum(1 for t in scoped if t.identity in unmeasured)
            )
            status = "partial" if skipped_here else "ok"
            reason = None

            if failed_suite == suite.name:
                status, reason = "failed", refused.diagnosis["line"]

            fresh[suite.name] = new_entry(
                status,
                {
                    t.module: current_modules[t.module]
                    for t in scoped
                    if t.identity not in skipped_set and t.module in current_modules
                },
                tests_owned_by(shared_map, suites, suite),
                reason,
                measured_here,
                len(scoped),
            )

        entries = merged_entries(stored_entries, fresh, [s.name for s in suites])

        return suites_array(suites, entries), entries

    def assemble(
        done: set[str], stopped: bool = False
    ) -> tuple[Outcome, list[Target], list[str], int]:
        skipped_ids = [target.identity for target in queue if target.identity not in done]
        skipped_set = set(skipped_ids)
        measured = [
            target
            for target in targets
            if target.identity not in skipped_set and target.identity not in unmeasured
        ]
        reused = sum(1 for target in measured if target.reused)
        values = overlay_values(measured)
        overlay = Overlay(METRICS, values, repository / settings["overlay"])
        suites_list, suite_entries = suites_result(done, skipped_set, refused)
        documents = [
            (record_path(repository, "mutation"), record_document("mutation", suite_entries)),
            (
                repository / settings["record"],
                record_for(key, commit, support, targets, queued, done, unmeasured, record),
            ),
            (
                repository / settings["survivors"],
                survivors_document(
                    commit,
                    measured,
                    skipped_ids,
                    reused,
                    no_covering_test,
                    excluded,
                    no_line,
                    unowned,
                ),
            ),
        ]
        findings = [finding_for(t, values) for t in measured if t.survived > 0]
        targeted = {target.module for target in targets}
        outcome = Outcome(
            findings,
            overlay,
            documents,
            stopped,
            len(measured),
            len(targets),
            frozenset(
                {target.module for target in measured}
                | {target.module for target in excluded if target.module not in targeted}
                | {target.module for target in no_line if target.module not in targeted}
                | {target.module for target in unowned if target.module not in targeted}
            ),
            shared_tests,
            excluded=excluded_document(excluded),
            unowned=unowned_document(unowned),
            suites=suites_list,
            recorded_inputs=recorded_inputs(suites, ticked, stored_entries, current_modules),
        )

        return outcome, measured, skipped_ids, reused

    if queue:
        labelled = len(suites) > 1
        mutant_copies = MutantCopies(
            repository, work, settings["max_workers"], settings.get("carry", ())
        )
        restore_handler = install_stop_handler(work)
        end_watch = None
        BUDGET_SPENT.clear()

        try:
            baselines = Baselines(
                repository, work, settings["max_workers"], settings.get("carry", ())
            )
            tally_lock = threading.Lock()
            workers = settings["max_workers"]

            for suite in {
                by_name[target.suite].name: by_name[target.suite] for target in queue
            }.values():
                if suite.name in warmup_seconds:
                    baselines.prime(
                        mutant_command(suite, workers=workers), suite, warmup_seconds[suite.name]
                    )

            def plan_for(target: Target) -> Callable[[int], tuple[list[str] | str, float]]:
                suite = by_name[target.suite]
                whole = mutant_command(suite, workers=workers)
                subject = f"the {suite.name} test command" if labelled else "the test command"
                selected_subject = (
                    f"the selected test command for {target.file}"
                    if suite.language == "typescript"
                    else "the selected test command"
                )
                chosen = [target.selections[index] for index in target.to_run]
                killers = [target.previous.get(index, frozenset()) for index in target.to_run]
                node_sets = [
                    target.nodes[index] if index < len(target.nodes) else None
                    for index in target.to_run
                ]

                def baseline(
                    command: list[str] | str,
                    label: str,
                    fallback: bool = False,
                    limit: float | None = None,
                ) -> float | None:
                    if deadline is not None and CLOCK() >= deadline:
                        raise Stopped

                    try:
                        return baselines.seconds(
                            command, label, suite, fallback=fallback, limit=limit
                        )
                    except Refusal:
                        if deadline is not None and CLOCK() >= deadline:
                            raise Stopped from None

                        raise

                def lookup(index: int) -> tuple[list[str] | str, float]:
                    seconds = None
                    command = whole
                    stopping = mutant_command(suite, True, workers)
                    files = chosen[index]
                    nodes = node_sets[index]

                    if suite.language == "typescript":
                        selected = selected_command(suite, None, workers=workers, file=target.file)
                    elif files and len(files) * 2 <= suite_size:
                        selected = selected_command(suite, files, workers=workers, nodes=nodes)
                    else:
                        selected = None

                    if selected is not None and selected != whole:
                        whole_seconds = baselines.recorded(whole, suite)
                        limit = (
                            timeout_for(whole_seconds, settings["timeout_factor"])
                            if whole_seconds is not None
                            else None
                        )
                        seconds = baseline(selected, selected_subject, fallback=True, limit=limit)

                        if seconds is not None:
                            command = selected
                            stopping = selected_command(
                                suite,
                                files,
                                True,
                                killers[index],
                                workers,
                                file=target.file,
                                nodes=nodes,
                            )

                    if seconds is None:
                        seconds = baseline(whole, subject)

                    with tally_lock:
                        ran["selection" if command is not whole else "whole"] += 1

                    return stopping, timeout_for(seconds, settings["timeout_factor"])

                return lookup

            budget = settings["max_minutes"]
            started = CLOCK()
            deadline = started + budget * 60 if budget is not None else None
            end_watch = watch_budget(deadline, CLOCK) if deadline is not None else None
            last = {"at": started}

            def finish(target: Target, outcome: list[MutantResult]) -> None:
                results = {
                    index: result for index, result in zip(target.to_run, outcome, strict=True)
                }
                settle(target, results, hashes, tests)
                done.add(target.identity)
                suite_done[target.suite] += 1
                waiting[target.suite] -= 1
                announce(target.suite)

                if waiting[target.suite] == 0:
                    upcoming = [name for name in waiting if waiting[name] > 0]

                    if upcoming:
                        announce(upcoming[0])
                now = CLOCK()

                if now - last["at"] >= CHECKPOINT_SECONDS:
                    last["at"] = now

                    if checkpoint is None:
                        write_checkpoint(
                            repository / settings["record"],
                            record_for(
                                key, commit, support, targets, queued, done, unmeasured, record
                            ),
                        )
                    else:
                        try:
                            checkpoint(assemble(done)[0])
                        except OSError:
                            return

            try:
                run_functions(
                    queue,
                    lambda target: run_function(
                        repository,
                        work,
                        mutants_for(target, sources),
                        plan_for(target),
                        by_name[target.suite],
                        hashes if target.language == "python" else None,
                        settings.get("carry", ()),
                        **({"copies": mutant_copies} if mutant_copies.enabled else {}),
                        **({"deadline": deadline, "clock": CLOCK} if deadline is not None else {}),
                    ),
                    settings["max_workers"],
                    deadline,
                    CLOCK,
                    finish,
                )
            except Refusal as refusal:
                if not done:
                    raise

                refused = refusal
            stopped = STOP.is_set()
            remove_stale_work_folders(work)
        finally:
            if end_watch is not None:
                end_watch()

            restore_handler()

    outcome, measured, skipped_ids, reused = assemble(done, stopped)

    if refused is not None:
        outcome = replace(
            outcome,
            refused=True,
            diagnosis={
                **refused.diagnosis,
                "line": f"the run ended early: {refused.diagnosis['line']}",
            },
        )
    mutated = len(measured) - reused

    if sizing_line is not None:
        print(sizing_line, file=sys.stderr)

    print(
        f"recognizer-sensors: mutation: {reused} of {len(targets)} functions reused, "
        f"{mutated} mutated, {len(skipped_ids)} skipped (uncovered-by-budget)",
        file=sys.stderr,
    )

    site_total = sum(sum(target.covered) for target in measured)
    site_reused = sum(len(target.kept) for target in measured)
    print(
        f"recognizer-sensors: mutation: {site_reused} of {site_total} sites reused, "
        f"{site_total - site_reused} run",
        file=sys.stderr,
    )
    if modules is not None:
        carried_count = sum(1 for target in targets if target.carried)
        print(
            f"recognizer-sensors: mutation: scoped to {len(modules)} modules; "
            f"{carried_count} functions carried from the record, "
            f"{len(unmeasured)} outside the scope have no result",
            file=sys.stderr,
        )

    if excluded:
        print(
            f"recognizer-sensors: mutation: {len(excluded)} functions in "
            f"{len({target.module for target in excluded})} modules not tested because "
            "their files are not in the coverage report",
            file=sys.stderr,
        )

    if unowned:
        print(
            f"recognizer-sensors: mutation: {len(unowned)} functions in "
            f"{len({target.module for target in unowned})} modules not tested because "
            "no test suite covers their files",
            file=sys.stderr,
        )

    print(
        f"recognizer-sensors: mutation: {no_covering_test} functions without a covering test; "
        f"{ran['selection']} mutants ran a selection, {ran['whole']} ran the whole suite",
        file=sys.stderr,
    )

    (repository / STALE_OVERLAY).unlink(missing_ok=True)

    return outcome
