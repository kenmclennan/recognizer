import hashlib
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

from recognizer_scan_csharp.calls import resolve_calls
from recognizer_scan_csharp.declarations import SourceFile, read_source
from recognizer_scan_csharp.discovery import directory_of, discover, selection
from recognizer_scan_csharp.entry_points import convention_roots, is_entry_point
from recognizer_scan_csharp.extensions import extension_edges
from recognizer_scan_csharp.index import Index
from recognizer_scan_csharp.markup import read_markup
from recognizer_scan_csharp.outline import member_of
from recognizer_scan_csharp.parse import parse_file
from recognizer_scan_csharp.projects import Project, load_projects, owner_of, reach_of
from recognizer_scan_csharp.resolve import Collected, Resolver

SCANNER_NAME = "recognizer-scan-csharp"


@dataclass
class Scan:
    document: dict
    damaged: int
    total: int
    left_out: dict[str, int]


def edge_order(edge: dict) -> tuple:
    return (
        edge["from"],
        edge["line"],
        edge["to"],
        edge["kind"],
        edge.get("member", ""),
        ",".join(edge.get("names", [])),
    )


def module_kind(members: list[dict]) -> str:
    exported = [m for m in members if m["exported"]]

    if exported and all(m["kind"] == "interface" for m in exported):
        return "interface"

    return "module"


def including_projects(projects: dict[str, Project], sources: list[str]) -> dict[str, set[str]]:
    including: dict[str, set[str]] = {path: set() for path in sources}

    for path in sources:
        owner = owner_of(projects, path)

        if owner:
            including[path].add(owner)

    for project in projects.values():
        for link in project.links:
            if link in including:
                including[link].add(project.key)

    return including


def is_scanned(projects: dict[str, Project], keys: set[str]) -> bool:
    return not keys or any(not projects[k].test for k in keys)


def skip_paths_of(projects: dict[str, Project]) -> list[str]:
    scanned = [p.directory for p in projects.values() if not p.test]

    def holds(directory: str, other: str) -> bool:
        return directory == "." or other == directory or other.startswith(directory + "/")

    return sorted(
        {
            p.directory
            for p in projects.values()
            if p.test and not any(holds(p.directory, other) for other in scanned)
        }
    )


def read_all(
    root: Path, paths: list[str], projects: dict[str, Project], including: dict[str, set[str]]
) -> tuple[list[SourceFile], list[dict]]:
    files = []
    hashes = []

    for path in paths:
        data = (root / path).read_bytes()
        file = read_source(path, directory_of(path), parse_file(data))
        keys = frozenset(k for k in including[path] if not projects[k].test)
        file.projects = keys or frozenset({f"file:{path}"})
        reach: set[str] = set()

        for key in file.projects:
            reach |= reach_of(projects, key)

        file.reach = frozenset(reach)
        files.append(file)
        hashes.append({"path": path, "hash": hashlib.sha256(data).hexdigest()})

    return files, hashes


def global_usings(files: list[SourceFile]) -> dict[str, list]:
    found: dict[str, list] = {}

    for file in files:
        for item in file.usings:
            if item.is_global:
                for key in file.projects:
                    found.setdefault(key, []).append(item)

    return found


def scan_with_stats(root: Path, commit: str | None, modified: bool | None = None) -> Scan:
    root = Path(root)
    found = discover(root)
    projects = load_projects(root, found.projects, found.solutions)
    including = including_projects(projects, found.sources)
    paths = [p for p in found.sources if is_scanned(projects, including[p])]
    files, hashes = read_all(root, paths, projects, including)
    index = Index(files)
    resolver = Resolver(index, projects, global_usings(files))
    roots = convention_roots(files, index)
    collected = Collected()

    for order, file in enumerate(files):
        resolver.resolve_file(file, order, collected)
        extension_edges(file, resolver, order, collected)

    scanned = {f.path for f in files}
    imports: dict = {}
    markup_paths = [
        p
        for p in found.markup
        if (owner := owner_of(projects, p)) is None or not projects[owner].test
    ]

    for number, path in enumerate(markup_paths):
        data = read_markup(
            root, path, projects, files, scanned, resolver, imports, len(files) + number, collected
        )
        hashes.append({"path": path, "hash": hashlib.sha256(data).hexdigest()})

    hashes.sort(key=lambda item: item["path"])
    modules = []

    for file in files:
        members = [member_of(d) for d in file.decls if not d.outer]
        module = {
            "id": file.path,
            "language": "csharp",
            "kind": module_kind(members),
            "members": members,
        }

        if is_entry_point(file, roots):
            module["entry_point"] = True

        modules.append(module)

    unresolved = sorted(collected.unresolved, key=lambda u: (u["from"], u["line"], u["import"]))
    document = {
        "schema_version": 6,
        "scanner": {"name": SCANNER_NAME, "version": version(SCANNER_NAME)},
        "commit": commit,
        "modified": modified,
        "files": hashes,
        "selection": selection(skip_paths_of(projects)),
        "modules": modules,
        "edges": sorted(collected.edges(), key=edge_order),
        "foreign": [{"id": f"foreign:{n}", "name": n} for n in sorted(collected.foreign)],
        "calls": resolve_calls(files, index, resolver),
        "unresolved_imports": unresolved,
    }

    return Scan(document, sum(1 for f in files if f.damaged), len(files), found.left_out)


def scan(root: Path, commit: str | None, modified: bool | None = None) -> dict:
    return scan_with_stats(root, commit, modified).document
