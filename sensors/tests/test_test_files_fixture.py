import json
from pathlib import Path

import pytest

from recognizer_sensors.mutation.test_files import is_test_file

CASES = json.loads(
    (Path(__file__).parents[2] / "fixtures" / "sensors" / "test-files.json").read_text()
)


@pytest.mark.parametrize("case", CASES, ids=[case["path"] for case in CASES])
def test_is_test_file_agrees_with_the_shared_fixture(case):
    assert is_test_file(case["path"]) is case["test"]
