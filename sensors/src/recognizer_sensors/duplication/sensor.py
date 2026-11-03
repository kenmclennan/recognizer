from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.duplication.fingerprint import fingerprints
from recognizer_sensors.duplication.normalise import count_nodes, normalise
from recognizer_sensors.duplication.score import pruned_pairs
from recognizer_sensors.duplication.shapes import is_trivial_shape
from recognizer_sensors.functions import find_functions
from recognizer_sensors.identity import assign_identities
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import SettingsError

DEFAULTS = {"threshold": 0.82, "min_lines": 4, "min_nodes": 20}

PRINCIPLE = "Do not repeat yourself"
FIX_PATTERN = "extract-shared-function"


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

        if is_trivial_shape(node):
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
    identities = assign_identities([(u.module, u.qualified, u.start_line) for u in units])

    return [
        Unit(**{**unit.__dict__, "identity": identity})
        for unit, identity in zip(units, identities, strict=True)
    ]


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


def member_of(unit: Unit) -> dict:
    return {
        "module": unit.module,
        "name": unit.qualified,
        "file": unit.file,
        "lines": [unit.start_line, unit.end_line],
    }


def finding_for(members: list[Unit], score: float) -> dict:
    members = sorted(members, key=lambda unit: unit.identity)
    first, second = members[0], members[1]

    if len(members) == 2:
        finding_id = f"duplication:{first.identity}|{second.identity}"
        summary = (
            f"{first.qualified} in {first.module} is {round(score * 100)}% similar to "
            f"{second.qualified} in {second.module}"
        )
    else:
        finding_id = f"duplication:{first.identity}|{second.identity}#{len(members)}"
        names = ", ".join(f"{unit.qualified} in {unit.module}" for unit in members)
        summary = f"{len(members)} functions share one structure: {names}"

    return {
        "id": finding_id,
        "kind": "duplication",
        "severity": "warning",
        "principle": PRINCIPLE,
        "fix_pattern": FIX_PATTERN,
        "summary": summary,
        "evidence": {
            "modules": sorted({unit.module for unit in members}),
            "members": [member_of(unit) for unit in members],
            "measures": {"similarity": round(score, 3)},
        },
    }


def families(edges: list[tuple[int, int, float]]) -> list[tuple[list[int], float]]:
    parent: dict[int, int] = {}

    def find(node: int) -> int:
        parent.setdefault(node, node)

        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]

        return node

    for i, j, _ in edges:
        parent[find(i)] = find(j)

    members: dict[int, set[int]] = {}
    lowest: dict[int, float] = {}

    for i, j, score in edges:
        root = find(i)
        members.setdefault(root, set()).update((i, j))
        lowest[root] = min(lowest.get(root, score), score)

    return [(sorted(nodes), lowest[root]) for root, nodes in members.items()]


def run(repository: Path, scans: list[Scan], settings: dict) -> list[dict]:
    by_language: dict[str, list[Unit]] = {}

    for scan in scans:
        by_language.setdefault(scan.language, []).extend(collect_units(repository, scan, settings))

    findings = []

    for units in by_language.values():
        sets = [unit.fingerprints for unit in units]
        edges = [
            (i, j, intersection / union)
            for i, j, intersection, union in pruned_pairs(sets, settings["threshold"])
            if not nested(units[i], units[j])
        ]

        for indices, score in families(edges):
            findings.append(finding_for([units[i] for i in indices], score))

    return findings
