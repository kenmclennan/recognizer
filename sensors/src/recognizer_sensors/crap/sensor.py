import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from recognizer_sensors.crap.complexity import cyclomatic_complexity
from recognizer_sensors.crap.lcov import Coverage, function_coverage, read_lcov
from recognizer_sensors.functions import find_functions
from recognizer_sensors.identity import assign_identities
from recognizer_sensors.outcome import Outcome, Overlay
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import SettingsError

DEFAULTS = {
    "threshold": 30,
    "coverage": "coverage/lcov.info",
    "overlay": ".recognizer/cache/overlays/crap.json",
}

PRINCIPLE = "Complex code needs tests"
FIX_PATTERN = "simplify-or-test"

METRICS = [
    {"name": "complexity", "type": "count", "granularity": "member", "bad": "high"},
    {"name": "coverage", "type": "ratio", "granularity": "member", "bad": "low"},
    {"name": "crap", "type": "number", "granularity": "member", "bad": "high"},
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


def relative_path(key: str, value: object) -> str:
    if not isinstance(value, str) or not value:
        raise SettingsError(f"{key} must be a non-empty string")

    path = PurePosixPath(value)

    if path.is_absolute() or ".." in path.parts:
        raise SettingsError(f"{key} must be a relative path inside the repository")

    return value


def parse_settings(raw: dict) -> dict:
    unknown = sorted(set(raw) - set(DEFAULTS))

    if unknown:
        raise SettingsError(f"unknown setting: {', '.join(unknown)}")

    settings = {**DEFAULTS, **raw}
    threshold = settings["threshold"]

    if isinstance(threshold, bool) or not isinstance(threshold, int | float):
        raise SettingsError("threshold must be a number")

    if not threshold > 0:
        raise SettingsError("threshold must be above 0")

    return {
        "threshold": float(threshold),
        "coverage": relative_path("coverage", settings["coverage"]),
        "overlay": relative_path("overlay", settings["overlay"]),
    }


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


def finding_for(identity: str, m: Measured, threshold: float) -> dict | None:
    if m.coverage is None:
        if m.complexity < threshold:
            return None

        summary = (
            f"{m.qualified} in {m.module} has complexity {m.complexity} and unknown coverage, "
            f"CRAP at least {m.complexity}"
        )
        measures = {"complexity": m.complexity}
    else:
        score = crap_score(m.complexity, m.coverage)

        if score < threshold:
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

    return {
        "id": f"crap:{identity}",
        "kind": "crap",
        "severity": "warning",
        "principle": PRINCIPLE,
        "fix_pattern": FIX_PATTERN,
        "summary": summary,
        "evidence": {
            "modules": [m.module],
            "members": [
                {
                    "module": m.module,
                    "name": m.qualified,
                    "file": m.file,
                    "lines": [m.start_line, m.end_line],
                }
            ],
            "measures": measures,
        },
    }


def run(repository: Path, scans: list[Scan], settings: dict) -> Outcome:
    coverage = read_lcov(repository / settings["coverage"], repository)

    if coverage is None:
        print(
            f"recognizer-sensors: crap: coverage file {settings['coverage']} is missing or "
            "unreadable; coverage is unknown for every function",
            file=sys.stderr,
        )

    findings = []
    values: dict[str, dict[str, float]] = {"complexity": {}, "coverage": {}, "crap": {}}

    for scan in scans:
        for identity, m in measure_scan(repository, scan, coverage):
            values["complexity"][identity] = m.complexity

            if m.coverage is not None:
                values["coverage"][identity] = round(m.coverage, 4)
                values["crap"][identity] = round(crap_score(m.complexity, m.coverage), 3)

            finding = finding_for(identity, m, settings["threshold"])

            if finding is not None:
                findings.append(finding)

    overlay = Overlay(METRICS, values, repository / settings["overlay"])

    return Outcome(findings, overlay)
