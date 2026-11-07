import json

import pytest
from conftest import EXAMPLES, load_schema
from jsonschema import Draft202012Validator

VALID = sorted((EXAMPLES / "valid").glob("*.json"))
INVALID = sorted((EXAMPLES / "invalid").glob("*.json"))


def test_schema_is_valid_draft_2020_12():
    Draft202012Validator.check_schema(load_schema())


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.name)
def test_valid_example_validates(path):
    Draft202012Validator(load_schema()).validate(json.loads(path.read_text()))


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_example_fails(path):
    assert not Draft202012Validator(load_schema()).is_valid(json.loads(path.read_text()))


def test_schema_version_is_now_seven():
    assert load_schema()["properties"]["schema_version"] == {"const": 7}


def test_the_csharp_skip_paths_example_lists_two_directories():
    document = json.loads((EXAMPLES / "valid" / "csharp-skip-paths.json").read_text())

    assert len(document["selection"]["skip_paths"]) == 2
    assert document["modules"][0]["language"] == "csharp"


@pytest.mark.parametrize(
    "name",
    ["skip-paths-not-array.json", "skip-paths-backslash.json", "skip-paths-duplicate.json"],
)
def test_the_skip_paths_invalid_examples_fail_for_their_own_field(name):
    document = json.loads((EXAMPLES / "invalid" / name).read_text())
    errors = list(Draft202012Validator(load_schema()).iter_errors(document))

    assert errors
    assert all("skip_paths" in list(error.absolute_path) for error in errors)


def test_a_scan_without_skip_paths_stays_valid():
    document = json.loads((EXAMPLES / "valid" / "rust-module.json").read_text())

    assert "skip_paths" not in document["selection"]
    Draft202012Validator(load_schema()).validate(document)
