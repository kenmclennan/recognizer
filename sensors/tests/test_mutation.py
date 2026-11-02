import json

import pytest
from conftest import FINDINGS_SCHEMA, mutate_repository, mutate_settings
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.mutation import sensor
from recognizer_sensors.settings import SettingsError

OVERLAY = ".recognizer/cache/overlays/mutate.json"
SURVIVORS = ".recognizer/cache/mutation/survivors.json"


def measure(root, script):
    return main(
        [
            "mutate",
            "--repository",
            str(root),
            "--output",
            str(root / OVERLAY),
            "--settings",
            mutate_settings(script),
        ]
    )


def sense(root, tmp_path, commit=None):
    output = tmp_path / "findings.json"
    argv = ["mutation", "--repository", str(root), "--output", str(output)]

    if commit:
        argv += ["--commit", commit]

    assert main(argv) == 0

    return json.loads(output.read_text())


def test_the_weak_run_yields_one_warning_per_function_with_a_survivor(tmp_path):
    root, commit = mutate_repository(tmp_path)
    measure(root, "tests/weak.py")

    document = sense(root, tmp_path)

    Draft202012Validator(json.loads(FINDINGS_SCHEMA.read_text())).validate(document)
    assert document["commit"] == commit
    assert document["settings"] == {"overlay": OVERLAY, "survivors": SURVIVORS}
    assert [(f["id"], f["summary"]) for f in document["findings"]] == [
        (
            "mutation:app/rules.py::both",
            "both in app/rules.py has 1 surviving mutation: line 10 and to or",
        ),
        (
            "mutation:app/rules.py::grade",
            "grade in app/rules.py has 2 surviving mutations: line 2 >= to >, line 4 >= to >",
        ),
    ]

    finding = document["findings"][1]

    assert finding["kind"] == "mutation"
    assert finding["severity"] == "warning"
    assert finding["principle"] == "Tests must catch changes"
    assert finding["fix_pattern"] == "strengthen-tests"
    assert finding["evidence"]["modules"] == ["app/rules.py"]
    assert finding["evidence"]["members"] == [
        {"module": "app/rules.py", "name": "grade", "file": "app/rules.py", "lines": [1, 6]}
    ]
    assert finding["evidence"]["measures"] == {
        "killed": 0,
        "survived": 2,
        "uncovered": 0,
        "score": 0.0,
    }


def test_the_strong_run_yields_none(tmp_path):
    root, _ = mutate_repository(tmp_path)
    measure(root, "tests/strong.py")

    assert sense(root, tmp_path)["findings"] == []


def test_a_removed_not_reads_as_removed():
    survivor = {"line": 3, "operator": "not", "replacement": ""}

    assert sensor.describe(survivor) == "line 3 not removed"


def unknown_case(root, capsys, expected):
    out = root.parent / "f.json"

    assert main(["mutation", "--repository", str(root), "--output", str(out)]) == 0
    assert json.loads(out.read_text())["findings"] == []

    lines = capsys.readouterr().err.strip().splitlines()

    assert len(lines) == 1
    assert lines[0].startswith("recognizer-sensors: mutation: ")
    assert expected in lines[0]
    assert lines[0].endswith("survivors are unknown")


def test_a_missing_overlay_is_unknown(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)

    unknown_case(root, capsys, f"overlay {OVERLAY} is missing or unreadable")


def test_an_unreadable_overlay_is_unknown(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    (root / OVERLAY).write_text("not json")

    unknown_case(root, capsys, "is missing or unreadable")


def test_an_overlay_from_another_commit_is_unknown(tmp_path, capsys):
    root, commit = mutate_repository(tmp_path)
    measure(root, "tests/weak.py")
    document = json.loads((root / OVERLAY).read_text())
    document["commit"] = "other"
    (root / OVERLAY).write_text(json.dumps(document))

    unknown_case(root, capsys, f"overlay is from commit other, not {commit}")


def test_a_missing_survivors_file_is_unknown(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    measure(root, "tests/weak.py")
    (root / SURVIVORS).unlink()

    unknown_case(root, capsys, f"survivors file {SURVIVORS} is missing, unreadable")


def test_a_survivors_file_from_another_commit_is_unknown(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    measure(root, "tests/weak.py")
    document = json.loads((root / SURVIVORS).read_text())
    document["commit"] = "other"
    (root / SURVIVORS).write_text(json.dumps(document))

    unknown_case(root, capsys, "does not match the overlay")


def test_a_survivor_count_that_disagrees_with_the_overlay_is_unknown(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    measure(root, "tests/weak.py")
    document = json.loads((root / SURVIVORS).read_text())
    del document["functions"]["app/rules.py::both"]
    (root / SURVIVORS).write_text(json.dumps(document))

    unknown_case(root, capsys, "does not match the overlay")


@pytest.mark.parametrize(
    "raw",
    [{"overlay": "/abs"}, {"survivors": "../x"}, {"overlay": ""}, {"overlay": 3}, {"nope": 1}],
)
def test_bad_settings_are_rejected(raw):
    with pytest.raises(SettingsError):
        sensor.parse_settings(raw)


def test_defaults():
    assert sensor.parse_settings({}) == {"overlay": OVERLAY, "survivors": SURVIVORS}
