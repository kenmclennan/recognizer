import hashlib
import json
from collections.abc import Iterable, Mapping
from pathlib import Path

RECORD_VERSION = 2
VERDICTS = ("killed", "survived", "timeout")


def command_hash(command: object) -> str:
    text = json.dumps(command, separators=(",", ":"), sort_keys=True)

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def body_hash(source: bytes) -> str:
    return hashlib.sha256(source).hexdigest()


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

    skipped = document.get("skipped")

    if not isinstance(skipped, list) or not all(isinstance(item, str) for item in skipped):
        document["skipped"] = []

    return document


def build_record(
    command: object, commit: str, support: str, functions: dict[str, dict], skipped: list[str]
) -> dict:
    return {
        "record_version": RECORD_VERSION,
        "command": command_hash(command),
        "commit": commit,
        "support": support,
        "functions": functions,
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
