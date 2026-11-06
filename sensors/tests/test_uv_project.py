import json
import shutil
import subprocess

import pytest
from conftest import git_commit, make_repository

from recognizer_sensors.cli import main

pytestmark = pytest.mark.skipif(shutil.which("uv") is None, reason="needs uv on PATH")

PYPROJECT = '[project]\nname = "t"\nversion = "0"\nrequires-python = ">=3.11"\n'

MODULE = "def f(a):\n    if a:\n        return 1\n    return 2\n\n\ndef g(a):\n    return a\n"

TESTS = "from m import f, g\n\n\ndef test_f():\n    assert f(1) == 1\n\n\ndef test_g():\n    assert g(1) == 2\n"


@pytest.fixture
def red_project(tmp_path):
    root = make_repository(
        tmp_path / "p", {"pyproject.toml": PYPROJECT, "m.py": MODULE, "test_m.py": TESTS}
    )
    subprocess.run(["uv", "lock", "-q"], cwd=root, check=True, capture_output=True)
    git_commit(root)

    return root


def test_crap_keeps_its_results_over_a_red_uv_project(red_project, tmp_path):
    output = tmp_path / "findings.json"

    status = main(
        ["crap", "--repository", str(red_project), "--output", str(output), "--settings", "{}"]
    )
    diagnosis = json.loads(output.read_text())["diagnosis"]

    assert status == 0
    assert diagnosis["code"] == "tests-failed"
    assert diagnosis["failing"] == {"count": 1, "names": ["test_m.py::test_g"]}


def test_mutation_refuses_over_a_red_uv_project_before_any_work_folder(
    red_project, tmp_path, capsys
):
    output = tmp_path / "findings.json"

    status = main(
        ["mutation", "--repository", str(red_project), "--output", str(output), "--settings", "{}"]
    )
    lines = capsys.readouterr().err.splitlines()
    reason = json.loads(lines[0].removeprefix("recognizer-reason "))

    assert status == 2
    assert reason["code"] == "tests-failed"
    assert reason["failing"] == {"count": 1, "names": ["test_m.py::test_g"]}
    assert not output.exists()
    assert not (red_project / ".recognizer/cache/mutation/work").exists()
