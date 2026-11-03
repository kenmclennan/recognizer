import json
import shutil
from collections import Counter

import pytest
from conftest import REPOSITORY, write_scans

from recognizer_sensors.duplication.sensor import parse_settings, run
from recognizer_sensors.scans import read_scans

CORPUS = REPOSITORY / "fixtures" / "duplication" / "corpus"
PAIRS = json.loads((CORPUS / "manifest.json").read_text())
LANGUAGES = ("python", "typescript", "kotlin", "rust")
LABELS = ("planted-copy", "planted-near-copy", "non-copy")


def findings_for(language, tmp_path):
    root = tmp_path / language
    shutil.copytree(CORPUS / language, root)
    write_scans(root)

    return run(root, read_scans(root), parse_settings({}))


def reported_pairs(findings):
    return {
        frozenset(f"{m['module']}::{m['name']}" for m in f["evidence"]["members"]) for f in findings
    }


def test_the_manifest_covers_every_language_and_label():
    counts = Counter((p["language"], p["label"]) for p in PAIRS)

    assert len(PAIRS) >= 36

    for language in LANGUAGES:
        for label in LABELS:
            assert counts[(language, label)] >= 3
        assert counts[(language, "non-copy-accessors")] >= 6


def test_every_accessor_pair_records_today_s_behaviour():
    accessors = [p for p in PAIRS if p["label"] == "non-copy-accessors"]

    assert accessors
    assert all(p["expected"] == "reported" and p["note"] for p in accessors)


@pytest.mark.parametrize("language", LANGUAGES)
def test_each_manifest_pair_is_reported_as_expected(language, tmp_path):
    reported = reported_pairs(findings_for(language, tmp_path))
    mismatches = [
        (p["a"], p["b"], p["label"], p["expected"])
        for p in PAIRS
        if p["language"] == language
        and (frozenset((p["a"], p["b"])) in reported) != (p["expected"] == "reported")
    ]

    assert mismatches == []
