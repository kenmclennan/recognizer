import json

import pytest
from conftest import REPOSITORY, event_lines
from jsonschema import Draft202012Validator

from recognizer_sensors import events


@pytest.fixture
def validator():
    return Draft202012Validator(
        json.loads((REPOSITORY / "schema" / "events.schema.json").read_text())
    )


def test_stage_and_estimate_lines_validate_against_the_schema(validator, capsys):
    events.stage("Coverage run: unit", 1, 3)
    events.estimate(5_400_000)
    events.estimate(None)

    lines = event_lines(capsys.readouterr().err)

    assert [line["event"] for line in lines] == ["stage", "estimate", "estimate"]
    assert lines[2]["remaining_ms"] is None

    for line in lines:
        validator.validate(line)


def test_result_and_settled_lines_validate_against_the_schema(validator, capsys):
    finding = {
        "id": "crap:a.py::f",
        "kind": "crap",
        "severity": "warning",
        "principle": "change-risk-anti-patterns",
        "summary": "f is risky",
        "evidence": {"modules": ["a.py"]},
    }

    events.result([finding], {"crap": {"a.py::f": 43.0}})
    events.result([], {"crap": {"a.py::g": 1.0}})
    events.settled(
        {
            "modified": False,
            "settings": {"threshold": 30},
            "inputs": {"a.py": "a" * 64},
            "counts": {"measured": 1, "total": 1},
        }
    )

    lines = event_lines(capsys.readouterr().err)

    assert [line["event"] for line in lines] == ["result", "result", "settled"]
    assert "findings" not in lines[1]

    for line in lines:
        validator.validate(line)
