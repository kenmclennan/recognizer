from dataclasses import asdict, dataclass
from pathlib import Path

from recognizer_sensors import events
from recognizer_sensors.crap.complexity import cyclomatic_complexity
from recognizer_sensors.crap.lcov import Coverage, function_coverage
from recognizer_sensors.functions import find_functions
from recognizer_sensors.hashes import scan_hashes, test_map
from recognizer_sensors.history import Tracker, elapsed_estimate, key_of
from recognizer_sensors.identity import assign_identities
from recognizer_sensors.outcome import Outcome, Overlay
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.principles import principle_fields
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import Refusal, SettingsError, diagnose, relative_path
from recognizer_sensors.testrun.records import (
    composed_tests,
    merged_entries,
    new_entry,
    read_entries,
    record_document,
    record_path,
    recorded_inputs,
    stored_coverage,
    suites_array,
    tests_owned_by,
)
from recognizer_sensors.testrun.suites import Suite, collect_suites, parse_suites, selected

DEFAULTS = {
    "threshold": 30,
    "coverage_limit": 0.6,
    "overlay": ".recognizer/cache/overlays/crap.json",
}

OPTIONAL = {"tests"}

PUBLISHED_THRESHOLD = 30
PUBLISHED_COVERAGE_LIMIT = 0.6
FIX_PATTERN = "simplify-or-test"

METRICS = [
    {"name": "complexity", "type": "count", "granularity": "member", "bad": "high"},
    {"name": "crap", "type": "number", "granularity": "member", "bad": "high"},
    {"name": "coverage", "type": "ratio", "granularity": "member", "bad": "low"},
]


@dataclass(frozen=True)
class Measured:
    module: str
    file: str
    qualified: str
    start_line: int
    end_line: int
    complexity: int
    coverage: float | None


def parse_coverage_limit(value: object) -> float | None:
    if value is False:
        return None

    if isinstance(value, bool) or not isinstance(value, int | float):
        raise SettingsError("coverage_limit must be a number above 0 and at most 1, or false")

    if not 0 < value <= 1:
        raise SettingsError("coverage_limit must be above 0 and at most 1")

    return float(value)


def parse_settings(raw: dict) -> dict:
    unknown = sorted(set(raw) - set(DEFAULTS) - OPTIONAL)

    if unknown:
        raise SettingsError(f"unknown setting: {', '.join(unknown)}")

    settings = {**DEFAULTS, **raw}
    threshold = settings["threshold"]

    if isinstance(threshold, bool) or not isinstance(threshold, int | float):
        raise SettingsError("threshold must be a number")

    if not threshold > 0:
        raise SettingsError("threshold must be above 0")

    parsed = {
        "threshold": float(threshold),
        "coverage_limit": parse_coverage_limit(settings["coverage_limit"]),
        "overlay": relative_path("overlay", settings["overlay"]),
    }
    parsed["suites"] = [asdict(s) for s in parse_suites(raw["tests"])] if "tests" in raw else None

    return parsed


def crap_score(complexity: int, coverage: float) -> float:
    return complexity**2 * (1 - coverage) ** 3 + complexity


def measure_file(
    module: str, path: str, source: bytes, coverage: Coverage | None
) -> list[tuple[Measured, int]]:
    grammar = grammar_for(path)

    if grammar is None:
        return []

    found = [
        f for f in find_functions(parse(grammar, source).root_node, grammar) if not f.node.has_error
    ]
    unit_ids = {f.node.id for f in found}
    lines = coverage.get(path) if coverage is not None else None
    measured = []

    for function in found:
        node = function.node
        start, end = node.start_point[0] + 1, node.end_point[0] + 1
        complexity = cyclomatic_complexity(node, grammar, unit_ids - {node.id})
        measured.append(
            (
                Measured(
                    module,
                    path,
                    function.qualified,
                    start,
                    end,
                    complexity,
                    function_coverage(lines, start, end),
                ),
                start,
            )
        )

    return measured


def measure_scan(
    repository: Path, scan: Scan, coverage: Coverage | None
) -> list[tuple[str, Measured]]:
    measured: list[Measured] = []

    for module in scan.modules:
        for path in module.files:
            try:
                source = (repository / path).read_bytes()
            except OSError:
                continue

            measured.extend(measure_file(module.id, path, source, coverage))

    identities = assign_identities([(m.module, m.qualified, start) for m, start in measured])

    return [(identity, m) for identity, (m, _) in zip(identities, measured, strict=True)]


def principle_for(threshold: float) -> dict:
    return principle_fields("change-risk-anti-patterns")


def finding_for(identity: str, m: Measured, threshold: float) -> dict | None:
    if m.coverage is None:
        if m.complexity <= threshold:
            return None

        summary = (
            f"{m.qualified} in {m.module} has complexity {m.complexity} and unknown coverage, "
            f"CRAP at least {m.complexity}"
        )
        measures = {"complexity": m.complexity}
    else:
        score = crap_score(m.complexity, m.coverage)

        if score <= threshold:
            return None

        summary = (
            f"{m.qualified} in {m.module} has complexity {m.complexity} and "
            f"{round(m.coverage * 100)}% coverage, CRAP {score:.1f}"
        )
        measures = {
            "complexity": m.complexity,
            "coverage": round(m.coverage, 4),
            "crap": round(score, 3),
        }

    summary = f"{summary}, over the limit of {threshold:g}"
    measures = {**measures, "limit": threshold}

    if threshold != PUBLISHED_THRESHOLD:
        measures = {**measures, "published": PUBLISHED_THRESHOLD}

    return {
        "id": f"crap:{identity}",
        "kind": "crap",
        "severity": "warning",
        **principle_for(threshold),
        "fix_pattern": FIX_PATTERN,
        "summary": summary,
        "evidence": {
            "modules": [m.module],
            "members": [member_for(m)],
            "measures": measures,
        },
    }


def format_number(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))

    return repr(float(value))


def member_for(m: Measured) -> dict:
    return {
        "module": m.module,
        "name": m.qualified,
        "file": m.file,
        "lines": [m.start_line, m.end_line],
    }


def coverage_finding_for(identity: str, m: Measured, limit: float | None) -> dict | None:
    if limit is None or m.coverage is None or not m.coverage < limit:
        return None

    coverage = round(m.coverage, 4)
    measures = {"coverage": coverage, "limit": limit}

    if limit != PUBLISHED_COVERAGE_LIMIT:
        measures["published"] = PUBLISHED_COVERAGE_LIMIT

    return {
        "id": f"coverage:{identity}",
        "kind": "coverage",
        "severity": "warning",
        **principle_fields("code-coverage-guidelines"),
        "metric": "coverage",
        "summary": (
            f"{identity}: coverage {format_number(coverage)} is below {format_number(limit)}"
        ),
        "evidence": {
            "modules": [m.module],
            "members": [member_for(m)],
            "measures": measures,
        },
    }


def contributed(scans: list[Scan], part: Coverage, current: dict[str, str]) -> dict[str, str]:
    return {
        module.id: current[module.id]
        for scan in scans
        for module in scan.modules
        if module.id in current and any(path in part for path in module.files)
    }


def fresh_entries(
    repository: Path,
    scans: list[Scan],
    suites: tuple[Suite, ...],
    results: dict[str, dict],
    tests: dict[str, str],
) -> dict[str, dict]:
    current = scan_hashes(scans)
    fresh = {}

    for suite in suites:
        result = results.get(suite.name)

        if result is None:
            continue

        part = result["part"]
        fresh[suite.name] = new_entry(
            result["status"],
            contributed(scans, part, current) if part is not None else {},
            tests_owned_by(tests, suites, suite),
            result["reason"],
            coverage=part,
        )

    return fresh


def run(
    repository: Path, scans: list[Scan], settings: dict, names: list[str] | None = None
) -> Outcome:
    if settings.get("suites") is None:
        raise Refusal(
            diagnose(
                "coverage-unavailable",
                "coverage unavailable: no test suites are configured; "
                "add a tests list to .recognizer/config.yaml",
            )
        )

    suites = tuple(Suite(**item) for item in settings["suites"])
    chosen = {suite.name for suite in selected(suites, names)}
    stored = read_entries(repository, "crap")
    parts = {name: stored_coverage(entry) for name, entry in stored.items()}
    results: dict[str, dict] = {}
    scanned = {scan.language for scan in scans}
    coverage_runs = sum(1 for suite in selected(suites, names) if suite.language in scanned)
    tracker = Tracker(repository, "crap", key_of(chosen), coverage_runs + 1, elapsed_estimate)
    coverage, diagnosis = collect_suites(repository, scans, suites, names, parts, results, tracker)
    tests = test_map(repository, scans)
    entries = merged_entries(
        stored, fresh_entries(repository, scans, suites, results, tests), [s.name for s in suites]
    )

    findings = []
    values: dict[str, dict[str, float]] = {"complexity": {}, "coverage": {}, "crap": {}}
    inputs: set[str] = set()

    measured_scans = [measure_scan(repository, scan, coverage) for scan in scans]

    function_count = sum(len(measured) for measured in measured_scans)
    events.start(function_count, "functions")
    tracker.finish_stages("Measure functions")

    for measured in measured_scans:
        for identity, m in measured:
            inputs.add(m.module)
            values["complexity"][identity] = m.complexity

            if m.coverage is not None:
                values["coverage"][identity] = round(m.coverage, 4)
                values["crap"][identity] = round(crap_score(m.complexity, m.coverage), 3)

            finding = finding_for(identity, m, settings["threshold"])

            if finding is not None:
                findings.append(finding)

            coverage_finding = coverage_finding_for(identity, m, settings["coverage_limit"])

            if coverage_finding is not None:
                findings.append(coverage_finding)

    overlay = Overlay(METRICS, values, repository / settings["overlay"])

    if diagnosis is None:
        tracker.finish(function_count)

    return Outcome(
        findings,
        overlay,
        inputs=frozenset(inputs),
        documents=[(record_path(repository, "crap"), record_document("crap", entries))],
        tests=composed_tests(tests, suites, chosen, stored),
        diagnosis=diagnosis,
        suites=suites_array(suites, entries, chosen),
        recorded_inputs=recorded_inputs(suites, chosen, stored, scan_hashes(scans)),
    )
