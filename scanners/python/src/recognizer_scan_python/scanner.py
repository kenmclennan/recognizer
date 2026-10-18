import ast
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

from recognizer_scan_python.analysis import (
    ABSTRACT_BASES,
    Imports,
    expand,
    is_abstraction,
    module_kind,
    module_level_classes,
    read_imports,
    read_members,
)
from recognizer_scan_python.discovery import discover
from recognizer_scan_python.index import ModuleIndex

SCANNER_NAME = "recognizer-scan-python"


class ScanError(Exception):
    def __init__(self, problems: list[str]):
        super().__init__("\n".join(problems))
        self.problems = problems


@dataclass
class Parsed:
    module_id: str
    tree: ast.Module
    imports: Imports
    abstractions: set[str]


def parse_all(root: Path, module_ids: list[str]) -> dict[str, ast.Module]:
    trees = {}
    problems = []

    for module_id in module_ids:
        try:
            trees[module_id] = ast.parse((root / module_id).read_bytes(), filename=module_id)
        except SyntaxError as error:
            problems.append(f"{module_id}:{error.lineno or 0}: {error.msg}")
        except (ValueError, UnicodeDecodeError, RecursionError, MemoryError) as error:
            problems.append(f"{module_id}:0: {error}")

    if problems:
        raise ScanError(problems)

    return trees


def base_edges(parsed: Parsed, index: ModuleIndex, others: dict[str, Parsed]) -> list[dict]:
    edges = []

    for node in module_level_classes(parsed.tree):
        for base in node.bases:
            path = expand(base, parsed.imports.bindings)

            if not path or ".".join(path) in ABSTRACT_BASES:
                continue

            hit = index.longest(path)

            if hit is None or hit.length != len(path) - 1 or hit.module_id == parsed.module_id:
                continue

            kind = "implements" if path[-1] in others[hit.module_id].abstractions else "inherits"
            edges.append(
                {
                    "from": parsed.module_id,
                    "to": hit.module_id,
                    "kind": kind,
                    "line": node.lineno,
                    "member": node.name,
                    "to_member": path[-1],
                }
            )

    return edges


def edge_order(edge: dict) -> tuple:
    return (edge["from"], edge["line"], edge["to"], edge["kind"], edge.get("member", ""))


def scan(root: Path, source_roots: list[str], commit: str | None) -> dict:
    root = Path(root)
    module_ids = discover(root)
    trees = parse_all(root, module_ids)
    index = ModuleIndex(module_ids, source_roots)

    parsed = {}
    for module_id in module_ids:
        tree = trees[module_id]
        imports = read_imports(module_id, tree, index)
        abstractions = {
            node.name
            for node in module_level_classes(tree)
            if is_abstraction(node, imports.bindings)
        }
        parsed[module_id] = Parsed(module_id, tree, imports, abstractions)

    modules = []
    edges = []
    foreign_names = set()

    for module_id in module_ids:
        item = parsed[module_id]
        members = read_members(item.tree, item.imports.bindings)
        modules.append(
            {
                "id": module_id,
                "language": "python",
                "kind": module_kind(module_id, members),
                "members": members,
            }
        )

        for target, line in item.imports.edges:
            edges.append({"from": module_id, "to": target, "kind": "depends", "line": line})

        for name, line in item.imports.foreign:
            foreign_names.add(name)
            edges.append(
                {"from": module_id, "to": f"foreign:{name}", "kind": "depends", "line": line}
            )

        edges.extend(base_edges(item, index, parsed))

    return {
        "schema_version": 1,
        "scanner": {"name": SCANNER_NAME, "version": version(SCANNER_NAME)},
        "commit": commit,
        "modules": modules,
        "edges": sorted(edges, key=edge_order),
        "foreign": [{"id": f"foreign:{n}", "name": n} for n in sorted(foreign_names)],
    }
