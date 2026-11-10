import hashlib
import json
from collections.abc import Iterable, Mapping
from pathlib import Path

RECORD_VERSION = 3
VERDICTS = ("killed", "survived", "timeout")


def command_hash(command: object) -> str:
    text = json.dumps(command, separators=(",", ":"), sort_keys=True)

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def body_hash(source: bytes) -> str:
    return hashlib.sha256(source).hexdigest()


INVALID_SITE = object()


class RecordTables:
    def __init__(self) -> None:
        self.files: list[list[str]] = []
        self.sets: list[list[int]] = []
        self.file_ids: dict[tuple[str, str], int] = {}
        self.set_ids: dict[tuple[int, ...], int] = {}

    def intern(self, mapping: Mapping[str, str] | None) -> int | None:
        if mapping is None:
            return None

        ids = []

        for path, digest in mapping.items():
            key = (path, digest)

            if key not in self.file_ids:
                self.file_ids[key] = len(self.files)
                self.files.append([path, digest])

            ids.append(self.file_ids[key])

        ordered = tuple(sorted(ids))

        if ordered not in self.set_ids:
            self.set_ids[ordered] = len(self.sets)
            self.sets.append(list(ordered))

        return self.set_ids[ordered]

    def site(self, site: dict | None) -> dict | None:
        if site is None or site.get("ran") is None:
            return site

        return {"ran": self.intern(site["ran"]), "killer": self.intern(site.get("killer"))}


def resolve_set_list(document: dict) -> list[dict[str, str]] | None:
    files = document.get("files")
    sets = document.get("sets")

    if not isinstance(files, list) or not isinstance(sets, list):
        return None

    pairs = []

    for pair in files:
        if (
            not isinstance(pair, list)
            or len(pair) != 2
            or not all(isinstance(part, str) for part in pair)
        ):
            return None

        pairs.append((pair[0], pair[1]))

    resolved = []

    for members in sets:
        if not isinstance(members, list) or not all(
            type(member) is int and 0 <= member < len(pairs) for member in members
        ):
            return None

        resolved.append(dict(pairs[member] for member in members))

    return resolved


def resolve_site(site: object, sets: list[dict[str, str]]) -> object:
    if not isinstance(site, dict) or site.get("ran") is None:
        return site

    resolved = dict(site)

    for key in ("ran", "killer"):
        value = site.get(key)

        if value is None:
            continue

        if type(value) is not int or not 0 <= value < len(sets):
            return INVALID_SITE

        resolved[key] = sets[value]

    return resolved


def read_record(path: Path, command: object) -> dict | None:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    if (
        not isinstance(document, dict)
        or document.get("record_version") != RECORD_VERSION
        or not isinstance(document.get("commit"), str)
        or not isinstance(document.get("support"), str)
        or document.get("command") != command_hash(command)
        or not isinstance(document.get("functions"), dict)
    ):
        return None

    sets = resolve_set_list(document)

    if sets is None:
        return None

    for entry in document["functions"].values():
        listed = entry.get("sites") if isinstance(entry, dict) else None

        if not isinstance(listed, list):
            continue

        for index, site in enumerate(listed):
            resolved = resolve_site(site, sets)

            if resolved is INVALID_SITE:
                return None

            listed[index] = resolved

    skipped = document.get("skipped")

    if not isinstance(skipped, list) or not all(isinstance(item, str) for item in skipped):
        document["skipped"] = []

    return document


def build_record(
    command: object, commit: str, support: str, functions: dict[str, dict], skipped: list[str]
) -> dict:
    tables = RecordTables()
    interned = {
        identity: {**entry, "sites": [tables.site(site) for site in entry["sites"]]}
        for identity, entry in functions.items()
    }

    return {
        "record_version": RECORD_VERSION,
        "command": command_hash(command),
        "commit": commit,
        "support": support,
        "files": tables.files,
        "sets": tables.sets,
        "functions": interned,
        "skipped": skipped,
    }


def hash_map(value: object) -> bool:
    return isinstance(value, dict) and all(
        isinstance(path, str) and isinstance(digest, str) for path, digest in value.items()
    )


def site_well_formed(verdict: str | None, site: object) -> bool:
    if verdict is None:
        return site is None

    if not isinstance(site, dict):
        return False

    ran = site.get("ran")

    if ran is None:
        return isinstance(site.get("tests"), str)

    killer = site.get("killer")

    if not hash_map(ran):
        return False

    return killer is None if verdict == "survived" else hash_map(killer)


def recorded_entry(record: dict | None, identity: str, body: str, support: str) -> dict | None:
    if record is None or record.get("support") != support:
        return None

    entry = record["functions"].get(identity)

    if not isinstance(entry, dict) or entry.get("body") != body:
        return None

    verdicts = entry.get("verdicts")
    sites = entry.get("sites")

    if (
        not isinstance(verdicts, list)
        or not isinstance(sites, list)
        or len(verdicts) != len(sites)
        or not all(v is None or v in VERDICTS for v in verdicts)
        or not all(site_well_formed(v, s) for v, s in zip(verdicts, sites, strict=True))
    ):
        return None

    return entry


def conftests_for(path: str, hashes: Mapping[str, str]) -> set[str]:
    directories = path.split("/")[:-1]
    candidates = (
        "/".join([*directories[:depth], "conftest.py"]) for depth in range(len(directories) + 1)
    )

    return {candidate for candidate in candidates if candidate in hashes}


def with_conftests(files: Iterable[str], hashes: Mapping[str, str]) -> frozenset[str]:
    covered = set(files)

    for path in list(covered):
        covered |= conftests_for(path, hashes)

    return frozenset(covered)


def site_reusable(
    verdict: str,
    site: dict,
    hashes: Mapping[str, str],
    tests: str,
    cover: frozenset[str] | None,
) -> bool:
    ran = site.get("ran")

    if ran is None:
        return site.get("tests") == tests

    if cover is None:
        return False

    if verdict == "survived":
        return all(path in ran and ran[path] == hashes.get(path) for path in cover)

    killer = site.get("killer") or {}

    return bool(killer) and all(hashes.get(path) == digest for path, digest in killer.items())
