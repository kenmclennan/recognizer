import hashlib
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

from recognizer_scan_kotlin.calls import CallResolver
from recognizer_scan_kotlin.declarations import SourceFile, read_source
from recognizer_scan_kotlin.discovery import (
    build_files_in,
    build_module_of,
    directory_of,
    discover,
    selection,
)
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

    return "module"


def endpoints_of(module_id: str, members: list[dict]) -> set[str]:
    found = set()

    for member in members:
        found.add(f"{module_id}::{member['name']}")

        for method in member.get("methods", []):
            found.add(f"{module_id}::{member['name']}.{method['name']}")

    return found


def has_main(file: SourceFile) -> bool:
    return any(
        d.owner is None and d.kind == "function" and d.name == "main" and not d.has_receiver
        for d in file.decls
    )


def read_all(root: Path, paths: list[str]) -> tuple[list[SourceFile], list[dict]]:
    files = []
    hashes = []

    for path in paths:
        data = (root / path).read_bytes()
        files.append(read_source(path, directory_of(path), parse_file(data), data))
        hashes.append({"path": path, "hash": hashlib.sha256(data).hexdigest()})

    return files, hashes


def merged_build_hashes(root: Path, hashes: list[dict], modules: list[str]) -> list[dict]:
    known = {h["path"] for h in hashes}
    merged = list(hashes)

    for module in modules:
        for path in build_files_in(root, module):
            if path not in known:
                known.add(path)
                merged.append(
                    {"path": path, "hash": hashlib.sha256((root / path).read_bytes()).hexdigest()}
                )

    return sorted(merged, key=lambda h: h["path"])


def scan_with_stats(root: Path, commit: str | None, modified: bool | None = None) -> Scan:
    root = Path(root)
    paths = discover(root)
    files, hashes = read_all(root, paths)
    builds = {d: build_module_of(root, d) for d in sorted({f.directory for f in files})}
    index = Index(files, {f.path: builds[f.directory] for f in files})
    hashes = merged_build_hashes(root, hashes, sorted(set(builds.values())))
    resolver = Resolver(index)
    collected = Collected()

    for order, file in enumerate(files):
        resolver.resolve_file(file, order, collected)

    modules = []
    endpoints = set()

    for file in files:
        members = [member_of(d) for d in file.decls]
        endpoints |= endpoints_of(file.path, members)
        module = {
            "id": file.path,
            "language": "kotlin",
            "kind": module_kind(members),
            "members": members,
        }

        if has_main(file):
            module["entry_point"] = True

        expects = index.expect_files_of(file)

        if expects:
            module["actual_of"] = expects

        modules.append(module)

    calls = CallResolver(files, index, resolver, endpoints).scan_calls()
    unresolved = sorted(collected.unresolved, key=lambda u: (u["from"], u["line"], u["import"]))
    document = {
        "schema_version": 7,
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
