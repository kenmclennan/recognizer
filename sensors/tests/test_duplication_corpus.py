import json
import shutil
from collections import Counter

import pytest
from conftest import REPOSITORY, write_scans

from recognizer_sensors.duplication.sensor import parse_settings, run
from recognizer_sensors.scans import read_scans

CORPUS = REPOSITORY / "fixtures" / "duplication" / "corpus"
PAIRS = json.loads((CORPUS / "manifest.json").read_text())
LANGUAGES = ("python", "typescript", "kotlin", "rust", "csharp")
LABELS = ("planted-copy", "planted-near-copy", "non-copy")


def findings_for(language, tmp_path):
    root = tmp_path / language
    shutil.copytree(CORPUS / language, root)
    write_scans(root)

    return run(root, read_scans(root), parse_settings({}))


def member_names(row):
    return frozenset(row["members"]) if "members" in row else frozenset((row["a"], row["b"]))


def reported_pairs(findings):
    return {
        frozenset(f"{m['module']}::{m['name']}" for m in f["evidence"]["members"]) for f in findings
    }


def test_the_manifest_covers_every_language_and_label():
    counts = Counter((p["language"], p["label"]) for p in PAIRS)

    assert len(PAIRS) == 60

    for language in LANGUAGES:
        for label in LABELS:
            assert counts[(language, label)] >= 3
        assert counts[(language, "non-copy-accessors")] == 1
        assert counts[(language, "non-copy-constructors")] == 1
        assert counts[(language, "near-copy-not-accessor")] == 1


def test_every_skipped_family_is_not_reported_with_a_note():
    skipped = [p for p in PAIRS if p["label"] in ("non-copy-accessors", "non-copy-constructors")]

    assert len(skipped) == 2 * len(LANGUAGES)
    assert all(len(p["members"]) in (3, 4) for p in skipped)
    assert all(p["expected"] == "not-reported" and p["note"] for p in skipped)


def test_every_near_copy_of_an_accessor_is_still_reported():
    guards = [p for p in PAIRS if p["label"] == "near-copy-not-accessor"]

    assert len(guards) == len(LANGUAGES)
    assert all(p["expected"] == "reported" and p["note"] for p in guards)


@pytest.mark.parametrize("language", LANGUAGES)
def test_each_manifest_pair_is_reported_as_expected(language, tmp_path):
    reported = reported_pairs(findings_for(language, tmp_path))
    mismatches = [
        (sorted(member_names(p)), p["label"], p["expected"])
        for p in PAIRS
        if p["language"] == language
        and (member_names(p) in reported) != (p["expected"] == "reported")
    ]

    assert mismatches == []


@pytest.mark.parametrize("language", LANGUAGES)
def test_each_language_yields_one_finding_per_reported_row(language, tmp_path):
    expected = [p for p in PAIRS if p["language"] == language and p["expected"] == "reported"]

    assert len(findings_for(language, tmp_path)) == len(expected) == 7
