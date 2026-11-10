import json
import shutil
import subprocess

import pytest
from conftest import git_commit, make_repository

from recognizer_sensors.cli import main

pytestmark = [
    pytest.mark.real_probes,
    pytest.mark.skipif(shutil.which("uv") is None, reason="needs uv on PATH"),
]

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


@pytest.fixture
def green_project(tmp_path):
    root = make_repository(
        tmp_path / "g",
        {
            "pyproject.toml": PYPROJECT,
            "m.py": MODULE,
            "test_m.py": TESTS.replace("g(1) == 2", "g(1) == 1"),
        },
    )
    subprocess.run(["uv", "lock", "-q"], cwd=root, check=True, capture_output=True)
    git_commit(root)

    return root


def snapshot(root):
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def test_crap_builds_its_uv_environment_under_the_cache_and_leaves_no_venv(green_project, tmp_path):
    status = main(
        [
            "crap",
            "--repository",
            str(green_project),
            "--output",
            str(tmp_path / "f.json"),
            "--settings",
            "{}",
        ]
    )

    assert status == 0
    assert not (green_project / ".venv").exists()
    assert (green_project / ".recognizer/cache/python-env").is_dir()


def test_crap_leaves_an_existing_venv_byte_for_byte_unchanged(green_project, tmp_path):
    subprocess.run(["uv", "venv", "-q"], cwd=green_project, check=True, capture_output=True)
    before = snapshot(green_project / ".venv")

    status = main(
        [
            "crap",
            "--repository",
            str(green_project),
            "--output",
            str(tmp_path / "f.json"),
            "--settings",
            "{}",
        ]
    )

    assert status == 0
    assert snapshot(green_project / ".venv") == before
    assert (green_project / ".recognizer/cache/python-env").is_dir()


ENVIRONMENT_TESTS = """import os
import subprocess
import sys
import tempfile
from pathlib import Path


def test_the_interpreter_is_the_project_environments():
    assert ".recognizer/cache/python-env" in Path(sys.executable).as_posix()


def test_a_child_uv_venv_runs_in_a_temporary_folder():
    assert "UV_PROJECT_ENVIRONMENT" not in os.environ

    with tempfile.TemporaryDirectory() as scratch:
        subprocess.run(["uv", "venv", "-q"], cwd=scratch, check=True, capture_output=True)

        assert (Path(scratch) / ".venv").is_dir()
"""


def test_crap_runs_a_projects_tests_in_its_own_interpreter_without_the_sensors_uv_variable(
    tmp_path,
):
    root = make_repository(
        tmp_path / "p",
        {
            "pyproject.toml": PYPROJECT,
            "m.py": MODULE,
            "test_m.py": TESTS.replace("g(1) == 2", "g(1) == 1"),
            "test_environment.py": ENVIRONMENT_TESTS,
        },
    )
    subprocess.run(["uv", "lock", "-q"], cwd=root, check=True, capture_output=True)
    git_commit(root)
    output = tmp_path / "findings.json"

    status = main(
        [
            "crap",
            "--repository",
            str(root),
            "--output",
            str(output),
            "--settings",
            "{}",
        ]
    )
    diagnosis = json.loads(output.read_text()).get("diagnosis")

    assert status == 0
    assert diagnosis is None
