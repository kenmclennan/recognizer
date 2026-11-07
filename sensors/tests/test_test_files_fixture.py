import json
from pathlib import Path

import pytest

from recognizer_sensors.mutation.test_files import (
    SCRIPT_EXTENSIONS,
    is_script_test_file,
    is_test_entry,
    is_test_file,
)

FIXTURES = Path(__file__).parents[2] / "fixtures" / "sensors"
CASES = json.loads((FIXTURES / "test-files.json").read_text())
EXTENSIONS = json.loads((FIXTURES / "test-file-extensions.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[case["path"] for case in CASES])
def test_is_test_file_agrees_with_the_shared_fixture(case):
    assert is_test_file(case["path"]) is case["test"]


def test_script_extensions_equal_the_shared_fixture_list():
    assert SCRIPT_EXTENSIONS == EXTENSIONS


@pytest.mark.parametrize("extension", EXTENSIONS)
@pytest.mark.parametrize("kind", ["test", "spec"])
def test_every_recogniser_accepts_every_script_form(extension, kind):
    path = f"src/a.{kind}.{extension}"

    assert is_test_file(path)
    assert is_test_entry(path)
    assert is_script_test_file(path)


@pytest.mark.parametrize("extension", EXTENSIONS)
def test_script_predicate_rejects_a_directory_member_without_the_suffix(extension):
    assert not is_script_test_file(f"tests/helper.{extension}")


@pytest.mark.parametrize("path", ["src/a.test.d.mts", "src/a.test.mtsx", "src/a.mts"])
def test_script_predicate_rejects_declarations_and_non_tests(path):
    assert not is_script_test_file(path)


def test_script_predicate_accepts_the_committed_mts_test_file():
    assert is_script_test_file("fixtures/typescript/module-extensions/h.test.mts")
