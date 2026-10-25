import ast
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

from recognizer_scan_python.analysis import (
    ABSTRACT_BASES,
    Imports,
    defined_names,
    expand,
    is_abstraction,
    module_kind,
    module_level_classes,
    read_imports,
)
from recognizer_scan_python.calls import CallResolver
from recognizer_scan_python.discovery import discover
from recognizer_scan_python.index import ModuleIndex
from recognizer_scan_python.infer import collect_classes, inferred_edges
from recognizer_scan_python.outline import read_members
from recognizer_scan_python.routes import ModuleNames, Router, named_edges

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
    source: str


def parse_all(root: Path, module_ids: list[str]) -> dict[str, tuple[ast.Module, str]]:
    trees = {}
    problems = []

    for module_id in module_ids:
        try:
            data = (root / module_id).read_bytes()
            trees[module_id] = (
                ast.parse(data, filename=module_id),
                data.decode("utf-8", errors="replace"),
            )
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
    inferred = edge.get("inferred", {})

    return (
        edge["from"],
        edge["line"],
        edge["to"],
        edge["kind"],
        edge.get("member", ""),
        inferred.get("class", ""),
        inferred.get("parameter", ""),
        ",".join(edge.get("names", [])),
    )


def import_edges(module_id: str, imports: Imports, router: Router) -> list[dict]:
    edges = [
        {"from": module_id, "to": target, "kind": "depends", "line": line}
        for target, line in imports.whole
    ]

    for statement in imports.named:
        for edge in named_edges(module_id, statement, router):
            edges.append(
                {"from": module_id, "to": edge["to"], "kind": "depends", "line": edge["line"]}
                | {key: edge[key] for key in ("names", "via") if key in edge}
            )

    return edges


def scan(root: Path, source_roots: list[str], commit: str | None) -> dict:
    root = Path(root)
    module_ids = discover(root)
    trees = parse_all(root, module_ids)
    index = ModuleIndex(module_ids, source_roots)

    parsed = {}
    for module_id in module_ids:
        tree, source = trees[module_id]
        imports = read_imports(module_id, tree, index)
        abstractions = {
            node.name
            for node in module_level_classes(tree)
            if is_abstraction(node, imports.bindings)
        }
        parsed[module_id] = Parsed(module_id, tree, imports, abstractions, source)

    router = Router({m: ModuleNames(defined_names(p.tree), p.imports) for m, p in parsed.items()})
    classes = collect_classes(parsed, index, router)

    modules = []
    outlines = {}
    edges = []
    foreign_names = set()

    for module_id in module_ids:
        item = parsed[module_id]
        members = read_members(item.tree, item.imports.bindings, item.source)
        outlines[module_id] = members
        modules.append(
            {
                "id": module_id,
                "language": "python",
                "kind": module_kind(module_id, members),
                "members": members,
            }
        )

        own = import_edges(module_id, item.imports, router)
        imported = {edge["to"] for edge in own}
        edges.extend(own)
        edges.extend(
            edge
            for edge in inferred_edges(module_id, item.tree, classes)
            if edge["to"] != module_id and edge["to"] not in imported
        )

        for name, line in item.imports.foreign:
            foreign_names.add(name)
            edges.append(
                {"from": module_id, "to": f"foreign:{name}", "kind": "depends", "line": line}
            )

        edges.extend(base_edges(item, index, parsed))

    calls = CallResolver(parsed, classes, outlines, index, router).scan_calls()

    return {
        "schema_version": 2,
        "scanner": {"name": SCANNER_NAME, "version": version(SCANNER_NAME)},
        "commit": commit,
        "modules": modules,
        "edges": sorted(edges, key=edge_order),
        "foreign": [{"id": f"foreign:{n}", "name": n} for n in sorted(foreign_names)],
        "calls": calls,
    }
