from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.duplication.fingerprint import fingerprints
from recognizer_sensors.duplication.functions import find_functions
from recognizer_sensors.duplication.normalise import count_nodes, normalise
from recognizer_sensors.duplication.score import pruned_pairs
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.scans import Scan

DEFAULTS = {"threshold": 0.82, "min_lines": 4, "min_nodes": 20}

PRINCIPLE = "Do not repeat yourself"
FIX_PATTERN = "extract-shared-function"


class SettingsError(ValueError):
    pass


@dataclass(frozen=True)
class Unit:
    module: str
    file: str
    qualified: str
    start_line: int
    end_line: int
    start_byte: int
    end_byte: int
    fingerprints: frozenset[int]
    identity: str = ""


def parse_settings(raw: dict) -> dict:
    unknown = sorted(set(raw) - set(DEFAULTS))

    if unknown:
        raise SettingsError(f"unknown setting: {', '.join(unknown)}")

    settings = {**DEFAULTS, **raw}
    threshold = settings["threshold"]

    if isinstance(threshold, bool) or not isinstance(threshold, int | float):
        raise SettingsError("threshold must be a number")

    if not 0 < threshold <= 1:
        raise SettingsError("threshold must be above 0 and at most 1")

    for key in ("min_lines", "min_nodes"):
        value = settings[key]

        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise SettingsError(f"{key} must be an integer of at least 1")

    return {
        "threshold": float(threshold),
        "min_lines": settings["min_lines"],
        "min_nodes": settings["min_nodes"],
    }


def units_in_file(module: str, path: str, source: bytes, settings: dict) -> list[Unit]:
    grammar = grammar_for(path)

    if grammar is None:
        return []

    units = []

    for found in find_functions(parse(grammar, source).root_node, grammar):
        node = found.node
        lines = node.end_point[0] - node.start_point[0] + 1

        if node.has_error or lines < settings["min_lines"]:
            continue

        if count_nodes(node) < settings["min_nodes"]:
            continue

        tree = normalise(node, set())

        if tree is None:
            continue

        units.append(
            Unit(
                module=module,
                file=path,
                qualified=found.qualified,
                start_line=node.start_point[0] + 1,
                end_line=node.end_point[0] + 1,
                start_byte=node.start_byte,
                end_byte=node.end_byte,
                fingerprints=fingerprints(tree),
            )
        )

    return units


def with_identities(units: list[Unit]) -> list[Unit]:
    counts = Counter((unit.module, unit.qualified) for unit in units)
    named = []

    for unit in units:
        identity = f"{unit.module}::{unit.qualified}"

        if counts[(unit.module, unit.qualified)] > 1:
            identity = f"{identity}@{unit.start_line}"

        named.append(Unit(**{**unit.__dict__, "identity": identity}))

    return named


def nested(a: Unit, b: Unit) -> bool:
    if a.file != b.file:
        return False

    return (a.start_byte <= b.start_byte and b.end_byte <= a.end_byte) or (
        b.start_byte <= a.start_byte and a.end_byte <= b.end_byte
    )


def collect_units(repository: Path, scan: Scan, settings: dict) -> list[Unit]:
    units: list[Unit] = []

    for module in scan.modules:
        for path in module.files:
            try:
                source = (repository / path).read_bytes()
            except OSError:
                continue

            units.extend(units_in_file(module.id, path, source, settings))

    return with_identities(units)


def finding_for(a: Unit, b: Unit, score: float) -> dict:
    first, second = sorted((a, b), key=lambda unit: unit.identity)
    percent = round(score * 100)

    return {
        "id": f"duplication:{first.identity}|{second.identity}",
        "kind": "duplication",
        "severity": "warning",
        "principle": PRINCIPLE,
        "fix_pattern": FIX_PATTERN,
        "summary": (
            f"{first.qualified} in {first.module} is {percent}% similar to "
            f"{second.qualified} in {second.module}"
        ),
        "evidence": {
            "modules": sorted({first.module, second.module}),
            "members": [
                {
                    "module": unit.module,
                    "name": unit.qualified,
                    "file": unit.file,
                    "lines": [unit.start_line, unit.end_line],
                }
                for unit in (first, second)
            ],
            "measures": {"similarity": round(score, 3)},
        },
    }


def run(repository: Path, scans: list[Scan], settings: dict) -> list[dict]:
    by_language: dict[str, list[Unit]] = {}

    for scan in scans:
        by_language.setdefault(scan.language, []).extend(collect_units(repository, scan, settings))

    findings = []

    for units in by_language.values():
        sets = [unit.fingerprints for unit in units]

        for i, j, intersection, union in pruned_pairs(sets, settings["threshold"]):
            if not nested(units[i], units[j]):
                findings.append(finding_for(units[i], units[j], intersection / union))

    return findings
