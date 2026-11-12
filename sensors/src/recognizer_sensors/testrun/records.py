import json
from collections.abc import Collection, Iterable, Mapping
from datetime import UTC, datetime
from pathlib import Path

from recognizer_sensors.crap.lcov import Coverage
from recognizer_sensors.hashes import digest_of
from recognizer_sensors.testrun.suites import Suite, owner_of

RECORD_VERSION = 1

ZEROS = "0" * 64

CACHE = Path(".recognizer/cache/suites")


def record_path(repository: Path, sensor: str) -> Path:
    return repository / CACHE / f"{sensor}.json"


def now_text() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def hash_map(value: object) -> dict[str, str] | None:
    if not isinstance(value, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in value.items()
    ):
        return None

    return dict(value)


def read_entries(repository: Path, sensor: str) -> dict[str, dict]:
    try:
        document = json.loads(record_path(repository, sensor).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

    if (
        not isinstance(document, dict)
        or document.get("suite_record_version") != RECORD_VERSION
        or document.get("sensor") != sensor
        or not isinstance(document.get("suites"), dict)
    ):
        return {}

    entries: dict[str, dict] = {}

    for name, entry in document["suites"].items():
        if not isinstance(entry, dict) or not isinstance(entry.get("ran_at"), str):
            continue

        if entry.get("status") not in ("ok", "failed", "partial"):
            continue

        inputs = hash_map(entry.get("inputs"))
        tests = hash_map(entry.get("tests"))

        if inputs is None or tests is None:
            continue

        entries[name] = {**entry, "inputs": inputs, "tests": tests}

    return entries


def record_document(sensor: str, entries: Mapping[str, dict]) -> dict:
    return {
        "suite_record_version": RECORD_VERSION,
        "sensor": sensor,
        "suites": {name: entries[name] for name in sorted(entries)},
    }


def new_entry(
    status: str,
    inputs: Mapping[str, str],
    tests: Mapping[str, str],
    reason: str | None = None,
    measured: int | None = None,
    total: int | None = None,
    coverage: Coverage | None = None,
) -> dict:
    entry: dict = {
        "ran_at": now_text(),
        "status": status,
        "inputs": dict(sorted(inputs.items())),
        "tests": dict(sorted(tests.items())),
    }

    if reason:
        entry["reason"] = reason

    if measured is not None:
        entry["measured"] = measured

    if total is not None:
        entry["total"] = total

    if coverage is not None:
        entry["coverage"] = {
            path: {str(number): hits for number, hits in sorted(lines.items())}
            for path, lines in sorted(coverage.items())
        }

    return entry


def stored_coverage(entry: Mapping) -> Coverage:
    raw = entry.get("coverage")
    part: Coverage = {}

    if not isinstance(raw, dict):
        return part

    for path, lines in raw.items():
        if not isinstance(lines, dict):
            continue

        try:
            part[path] = {int(number): int(hits) for number, hits in lines.items()}
        except (TypeError, ValueError):
            continue

    return part


def merged_entries(
    stored: Mapping[str, dict], fresh: Mapping[str, dict], names: Iterable[str]
) -> dict[str, dict]:
    entries = {name: stored[name] for name in names if name in stored}
    entries.update(fresh)

    return entries


def suites_array(suites: Iterable[Suite], entries: Mapping[str, dict]) -> list[dict]:
    listed = []

    for suite in suites:
        entry = entries.get(suite.name)

        if entry is None:
            listed.append({"name": suite.name, "status": "never", "ran_at": None})
            continue

        item: dict = {"name": suite.name, "status": entry["status"], "ran_at": entry["ran_at"]}

        for key in ("reason", "measured", "total"):
            if key in entry:
                item[key] = entry[key]

        listed.append(item)

    return listed


def composed_tests(
    current: Mapping[str, str],
    suites: Iterable[Suite],
    chosen: Collection[str],
    entries: Mapping[str, dict],
) -> str:
    everything = list(suites)
    unselected = {suite.name for suite in everything if suite.name not in chosen}

    if not unselected:
        return digest_of(current)

    composed: dict[str, str] = {}

    for path, digest in current.items():
        owner = owner_of(everything, path)

        if owner is None or owner.name not in unselected:
            composed[path] = digest
        else:
            composed[path] = entries.get(owner.name, {}).get("tests", {}).get(path, ZEROS)

    for name in unselected:
        for path, digest in entries.get(name, {}).get("tests", {}).items():
            composed.setdefault(path, digest)

    return digest_of(composed)


def tests_owned_by(
    current: Mapping[str, str], suites: Iterable[Suite], suite: Suite
) -> dict[str, str]:
    everything = list(suites)

    return {
        path: digest
        for path, digest in current.items()
        if (owner := owner_of(everything, path)) is not None and owner.name == suite.name
    }


def recorded_inputs(
    suites: Iterable[Suite],
    chosen: Collection[str],
    entries: Mapping[str, dict],
    current: Mapping[str, str],
) -> dict[str, str]:
    stale: dict[str, str] = {}

    for suite in suites:
        if suite.name in chosen:
            continue

        for module, digest in entries.get(suite.name, {}).get("inputs", {}).items():
            if module in current and current[module] != digest:
                stale.setdefault(module, digest)

    return stale
