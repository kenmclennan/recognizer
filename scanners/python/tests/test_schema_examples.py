import json

import pytest
from conftest import EXAMPLES, load_schema
from jsonschema import Draft202012Validator

VALID = sorted((EXAMPLES / "valid").glob("*.json"))
INVALID = sorted((EXAMPLES / "invalid").glob("*.json"))


def test_schema_is_valid_draft_2020_12():
    Draft202012Validator.check_schema(load_schema())


def test_required_examples_exist():
    assert {"design-example.json", "all-kinds.json"} <= {p.name for p in VALID}
    assert len(INVALID) >= 12


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.name)
def test_valid_example_validates(path):
    Draft202012Validator(load_schema()).validate(json.loads(path.read_text()))


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_example_fails(path):
    assert not Draft202012Validator(load_schema()).is_valid(json.loads(path.read_text()))


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_example_fails_for_its_own_defect(path):
    version = json.loads(path.read_text())["schema_version"]

    assert (version != 4) == path.name.startswith("schema-version-")


def test_version_3_example_is_refused_on_the_version():
    document = json.loads((EXAMPLES / "invalid" / "schema-version-3.json").read_text())
    errors = list(Draft202012Validator(load_schema()).iter_errors(document))

    assert [list(error.path) for error in errors] == [["schema_version"]]
