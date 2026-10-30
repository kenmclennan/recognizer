import hashlib
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

from recognizer_scan_kotlin.calls import CallResolver
from recognizer_scan_kotlin.declarations import SourceFile, read_source
from recognizer_scan_kotlin.discovery import build_module_of, directory_of, discover, selection
from recognizer_scan_kotlin.index import Index
from recognizer_scan_kotlin.outline import member_of
from recognizer_scan_kotlin.parse import parse_file
from recognizer_scan_kotlin.resolve import Collected, Resolver

SCANNER_NAME = "recognizer-scan-kotlin"


@dataclass
class Scan:
    document: dict
    damaged: int
    total: int


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

    return "package"


def endpoints_of(module_id: str, members: list[dict]) -> set[str]:
    found = set()

    for member in members:
        found.add(f"{module_id}::{member['name']}")

        for method in member.get("methods", []):
            found.add(f"{module_id}::{member['name']}.{method['name']}")

    return found


def read_all(root: Path, paths: list[str]) -> tuple[list[SourceFile], list[dict]]:
    files = []
    hashes = []

    for path in paths:
        data = (root / path).read_bytes()
        files.append(read_source(path, directory_of(path), parse_file(data)))
        hashes.append({"path": path, "hash": hashlib.sha256(data).hexdigest()})

    return files, hashes


def scan_with_stats(root: Path, commit: str | None, modified: bool | None = None) -> Scan:
    root = Path(root)
    paths = discover(root)
    files, hashes = read_all(root, paths)
    directories = sorted({f.directory for f in files})
    index = Index(files, {d: build_module_of(root, d) for d in directories})
    resolver = Resolver(index)
    collected = Collected()

    for order, file in enumerate(files):
        resolver.resolve_file(file, order, collected)

    modules = []
    endpoints = set()

    for directory in directories:
        decls = [d for f in files if f.directory == directory for d in f.decls]
        members = [member_of(d) for d in decls]
        endpoints |= endpoints_of(directory, members)
        modules.append(
            {
                "id": directory,
                "language": "kotlin",
                "kind": module_kind(members),
                "members": members,
            }
        )

    calls = CallResolver(files, index, resolver, endpoints).scan_calls()
    unresolved = sorted(collected.unresolved, key=lambda u: (u["from"], u["line"], u["import"]))
    document = {
        "schema_version": 5,
        "scanner": {"name": SCANNER_NAME, "version": version(SCANNER_NAME)},
        "commit": commit,
        "modified": modified,
        "files": hashes,
        "selection": selection(),
        "modules": modules,
        "edges": sorted(collected.edges(), key=edge_order),
        "foreign": [{"id": f"foreign:{n}", "name": n} for n in sorted(collected.foreign)],
        "calls": calls,
        "unresolved_imports": unresolved,
    }

    return Scan(document, sum(1 for f in files if f.damaged), len(files))


def scan(root: Path, commit: str | None, modified: bool | None = None) -> dict:
    return scan_with_stats(root, commit, modified).document
