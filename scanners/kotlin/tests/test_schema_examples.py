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


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_example_fails_for_its_own_defect(path):
    version = json.loads(path.read_text())["schema_version"]

    assert (version != 5) == path.name.startswith("schema-version-")


def test_version_4_example_is_refused_on_the_version():
    document = json.loads((EXAMPLES / "invalid" / "schema-version-4.json").read_text())
    errors = list(Draft202012Validator(load_schema()).iter_errors(document))

    assert [list(error.path) for error in errors] == [["schema_version"]]


def test_the_kotlin_example_carries_visibility_and_unresolved_imports():
    document = json.loads((EXAMPLES / "valid" / "kotlin-visibility.json").read_text())

    assert document["unresolved_imports"]
    assert all("visibility" in m for item in document["modules"] for m in item["members"])


@pytest.mark.parametrize(
    "name",
    [
        "visibility-private-exported.json",
        "visibility-unknown.json",
        "unresolved-import-extra-key.json",
    ],
)
def test_the_new_invalid_examples_are_refused_for_their_own_field(name):
    document = json.loads((EXAMPLES / "invalid" / name).read_text())
    errors = list(Draft202012Validator(load_schema()).iter_errors(document))

    assert errors
    assert document["schema_version"] == 5
