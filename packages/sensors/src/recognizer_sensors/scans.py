import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from recognizer_sensors.parsing import LANGUAGES


@dataclass(frozen=True)
class ScanMember:
    name: str
    exported: bool
    line: int | None


@dataclass(frozen=True)
class ScanModule:
    id: str
    files: tuple[str, ...]
    members: tuple[ScanMember, ...] = ()


@dataclass(frozen=True)
class ScanEdge:
    source: str
    target: str
    kind: str
    names: tuple[str, ...] = ()
    to_member: str | None = None


@dataclass(frozen=True)
class Scan:
    language: str
    modules: tuple[ScanModule, ...]
    modified: bool
    edges: tuple[ScanEdge, ...] = ()
    skip_paths: tuple[str, ...] = ()
    hashes: Mapping[str, str] = field(default_factory=dict)


def scan_path(repository: Path, language: str) -> Path:
    return repository / ".recognizer" / "cache" / f"scan.{language}.json"


def module_files(language: str, module_id: str, files: list[str]) -> tuple[str, ...]:
    return (module_id,) if module_id in files else ()


def read_members(raw: object) -> tuple[ScanMember, ...]:
    if not isinstance(raw, list):
        return ()

    members = []

    for entry in raw:
        if not isinstance(entry, dict):
            continue

        name, exported, line = entry.get("name"), entry.get("exported"), entry.get("line")

        if isinstance(name, str) and isinstance(exported, bool):
            members.append(ScanMember(name, exported, line if type(line) is int else None))

    return tuple(members)


def read_edges(raw: object) -> tuple[ScanEdge, ...]:
    if not isinstance(raw, list):
        return ()

    edges = []

    for entry in raw:
        if not isinstance(entry, dict):
            continue

        source, target, kind = entry.get("from"), entry.get("to"), entry.get("kind")
        names, to_member = entry.get("names"), entry.get("to_member")

        if not all(isinstance(value, str) for value in (source, target, kind)):
            continue

        edges.append(
            ScanEdge(
                source,
                target,
                kind,
                tuple(n for n in names if isinstance(n, str)) if isinstance(names, list) else (),
                to_member if isinstance(to_member, str) else None,
            )
        )

    return tuple(edges)


def read_skip_paths(document: dict) -> tuple[str, ...]:
    selection = document.get("selection")
    raw = selection.get("skip_paths") if isinstance(selection, dict) else None

    if not isinstance(raw, list):
        return ()

    return tuple(path for path in raw if isinstance(path, str))


def read_hashes(document: dict) -> dict[str, str]:
    hashes = {}

    for entry in document["files"]:
        path, digest = entry.get("path"), entry.get("hash")

        if isinstance(path, str) and isinstance(digest, str):
            hashes[path] = digest

    return hashes


def read_scan(repository: Path, language: str) -> Scan | None:
    try:
        document = json.loads(scan_path(repository, language).read_text(encoding="utf-8"))
        files = [entry["path"] for entry in document["files"]]
        module_entries = list(document["modules"])
        module_ids = [entry["id"] for entry in module_entries]
        modified = document.get("modified") is not False
    except (OSError, ValueError, KeyError, TypeError):
        return None

    if not all(isinstance(f, str) for f in files) or not all(
        isinstance(m, str) for m in module_ids
    ):
        return None

    modules = tuple(
        ScanModule(
            entry["id"],
            module_files(language, entry["id"], files),
            read_members(entry.get("members")),
        )
        for entry in module_entries
    )

    return Scan(
        language,
        modules,
        modified,
        read_edges(document.get("edges")),
        read_skip_paths(document),
        read_hashes(document),
    )


def read_scans(repository: Path) -> list[Scan]:
    scans = (read_scan(repository, language) for language in LANGUAGES)

    return [scan for scan in scans if scan is not None]
