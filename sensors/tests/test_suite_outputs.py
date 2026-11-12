import subprocess
from pathlib import Path

import pytest
from conftest import git_commit, make_repository

from recognizer_sensors.scans import read_scans
from recognizer_sensors.testrun.suites import (
    collect_suites,
    parse_suites,
    prepare_suite_folder,
    suite_environment,
    suite_folder,
)

BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"

LCOV_TEXT = "SF:app/m.py\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n"

CACHE = ".recognizer/cache/coverage"

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.com",
    "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
}


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")


def status(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(root), "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
        env=GIT_ENV,
    )

    return sorted(line for line in result.stdout.splitlines() if line)


def suite(**overrides):
    base = {
        "name": "api",
        "language": "python",
        "directory": ".",
        "command": "true",
        "coverage": {"path": f"{CACHE}/api/lcov.info", "format": "lcov"},
    }

    return {**base, **overrides}


def committed(tmp_path, files, ignores=".recognizer/cache/\n"):
    root = make_repository(tmp_path / "r", {".gitignore": ignores, **files})
    git_commit(root)

    return root


def test_a_python_suite_gets_both_variables_as_absolute_paths_in_the_cache(tmp_path):
    (python,) = parse_suites([suite()])
    environment = suite_environment(tmp_path, python)
    root = tmp_path.resolve() / ".recognizer" / "cache"

    assert environment == {
        "COVERAGE_FILE": str(root / "coverage" / "api" / "data"),
        "PYTHONPYCACHEPREFIX": str(root / "pycache"),
    }


@pytest.mark.parametrize("language", ["typescript", "kotlin", "rust", "csharp"])
def test_a_suite_of_another_language_gets_no_variables(tmp_path, language):
    extra = {"runner": "vitest"} if language == "typescript" else {}
    (other,) = parse_suites([suite(language=language, **extra)])

    assert suite_environment(tmp_path, other) == {}


def test_a_suite_env_value_wins_and_the_other_variable_is_still_set(tmp_path):
    (python,) = parse_suites([suite(env={"COVERAGE_FILE": "mine"})])

    assert list(suite_environment(tmp_path, python)) == ["PYTHONPYCACHEPREFIX"]


@pytest.mark.parametrize(
    ("name", "folder"), [("a b", "a-b"), ("../x", "-.-x"), ("api", "api"), (".hidden", "-hidden")]
)
def test_a_suite_name_cannot_leave_the_coverage_folder(name, folder):
    (parsed,) = parse_suites([suite(name=name)])

    assert suite_folder(parsed) == f"{CACHE}/{folder}"


def test_prepare_suite_folder_empties_only_that_suites_folder(tmp_path):
    (parsed,) = parse_suites([suite()])
    (tmp_path / CACHE / "api").mkdir(parents=True)
    (tmp_path / CACHE / "api" / "old").write_text("x")
    (tmp_path / CACHE / "web").mkdir(parents=True)
    (tmp_path / CACHE / "web" / "keep").write_text("x")

    prepare_suite_folder(tmp_path, parsed)

    assert list((tmp_path / CACHE / "api").iterdir()) == []
    assert (tmp_path / CACHE / "web" / "keep").exists()


def test_a_stale_report_is_not_read_when_the_suite_writes_none(tmp_path):
    root = committed(tmp_path, {"app/m.py": BODY})
    stale = root / CACHE / "api"
    stale.mkdir(parents=True)
    (stale / "lcov.info").write_text(LCOV_TEXT)
    results: dict = {}

    coverage, diagnosis = collect_suites(
        root, read_scans(root), parse_suites([suite()]), results=results
    )

    assert coverage == {}
    assert "left no coverage report at" in diagnosis["line"]
    assert results["api"]["status"] == "failed"
