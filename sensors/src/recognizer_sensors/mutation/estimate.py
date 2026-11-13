from pathlib import Path

from recognizer_sensors.hashes import digest_of, rust_test_entries, support_hash, test_hashes
from recognizer_sensors.mutation.commands import RUST_UNITS
from recognizer_sensors.mutation.inline_tests import unit_test_hashes
from recognizer_sensors.mutation.record import read_record, recorded_entry, site_reusable
from recognizer_sensors.mutation.sensor import collect_targets, owner_suite, record_key
from recognizer_sensors.scans import read_scans
from recognizer_sensors.testrun.suites import Suite, selected

UNIT = "functions"


def entry_reusable(entry: dict | None, sites: int, hashes: dict[str, str], tests: str) -> bool:
    if entry is None or len(entry["verdicts"]) != sites:
        return False

    for verdict, site in zip(entry["verdicts"], entry["sites"], strict=True):
        if verdict is None:
            continue

        ran = site.get("ran")
        cover = None if ran is None else frozenset(ran)

        if not site_reusable(verdict, site, hashes, tests, cover):
            return False

    return True


def planned_work(
    repository: Path,
    settings: dict,
    modules: set[str] | None = None,
    names: list[str] | None = None,
) -> dict | None:
    raw = settings.get("suites")

    if raw is None:
        return None

    suites = [Suite(**item) for item in raw]
    ticked = {suite.name for suite in selected(suites, names)}
    scans = [
        scan
        for scan in read_scans(repository)
        if any(suite.language == scan.language for suite in suites)
    ]
    record = read_record(repository / settings["record"], record_key(raw))

    if not settings["incremental"]:
        record = None

    rust_entries = rust_test_entries(repository)
    test_files = test_hashes(repository, scans, rust_entries)
    support = support_hash(test_files, rust_entries)
    hashes = {**test_files, **unit_test_hashes(repository, RUST_UNITS)}
    tests = digest_of(hashes)
    to_perform = 0
    reusable = 0

    for scan in scans:
        language_suites = [suite for suite in suites if suite.language == scan.language]
        found, _ = collect_targets(repository, scan)

        for target in found:
            owner = owner_suite(language_suites, target.file)

            if (
                owner is None
                or owner.name not in ticked
                or not target.sites
                or (modules is not None and target.module not in modules)
            ):
                continue

            entry = recorded_entry(record, target.identity, target.body, support)

            if entry_reusable(entry, len(target.sites), hashes, tests):
                reusable += 1
            else:
                to_perform += 1

    return {"unit": UNIT, "to_perform": to_perform, "reusable": reusable}
