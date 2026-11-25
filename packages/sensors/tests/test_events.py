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
