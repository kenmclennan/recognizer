import shutil
import subprocess

import pytest
from conftest import git_commit, make_repository
from test_probes import only_path, repository

from recognizer_sensors.scans import Scan, ScanModule
from recognizer_sensors.testrun import preflight as preflight_module
from recognizer_sensors.testrun.preflight import gaps

pytestmark = pytest.mark.real_probes

PYPROJECT = '[project]\nname = "t"\nversion = "0"\nrequires-python = ">=3.11"\n'


def python_scan(*directories):
    modules = tuple(
        ScanModule(f"m{n}", (f"{d}/m.py" if d else "m.py",)) for n, d in enumerate(directories)
    )

    return Scan("python", modules, False)


def poetry_projects(root, *directories):
    for directory in directories:
        (root / directory).mkdir(parents=True, exist_ok=True)
        (root / directory / "pyproject.toml").write_text(PYPROJECT)
        (root / directory / "poetry.lock").write_text("")
        (root / directory / "m.py").write_text("")

    git_commit_files(root)


def git_commit_files(root):
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"],
        cwd=root,
        check=True,
    )


def test_two_python_sub_projects_each_missing_tools_give_two_gaps(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, poetry='echo "coverage pytest"')
    root = repository(tmp_path)
    poetry_projects(root, "a", "b")

    found = gaps(root, [python_scan("a", "b")], {}, "crap")

    assert [gap["project"]["directory"] for gap in found] == ["a", "b"]
    assert found[0]["line"] == "coverage and pytest are not installed"
    assert found[0]["needs"] == ["crap"]
    assert found[0]["id"] == "crap:python:a:coverage-and-pytest-are-not-installed"
    assert found[0]["fix"] == {
        "text": "poetry add --group dev coverage pytest",
        "command": ["poetry", "add", "--group", "dev", "coverage", "pytest"],
        "cwd": "a",
        "env": {},
        "kind": "repository",
    }


def test_a_missing_runner_gives_that_gap_with_an_outside_fix(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)
    root = repository(tmp_path)
    (root / "Cargo.toml").write_text("")

    found = gaps(root, [Scan("rust", (), False)], {}, "mutation")

    assert [gap["line"] for gap in found] == ["cargo is not installed"]
    assert found[0]["fix"]["kind"] == "outside"
    assert found[0]["fix"]["text"] == "brew install rustup"
    assert found[0]["needs"] == ["mutation"]


def test_a_manual_edit_fix_has_no_command(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, npm="exit 0", npx="exit 0")
    root = repository(tmp_path)
    (root / "package.json").write_text("{}")

    found = gaps(root, [Scan("typescript", (), False)], {}, "crap")

    assert found[0]["line"] == "package.json has no test script"
    assert found[0]["fix"]["command"] is None
    assert found[0]["fix"]["kind"] == "outside"


def test_a_rust_project_missing_llvm_cov_is_the_only_gap_beside_a_fine_python_project(
    monkeypatch, tmp_path
):
    only_path(monkeypatch, tmp_path, poetry="echo", cargo="exit 1", python3="echo")
    root = repository(tmp_path)
    poetry_projects(root, "py")
    (root / "rs").mkdir()
    (root / "rs" / "Cargo.toml").write_text("")
    (root / "rs" / "lib.rs").write_text("")
    rust = Scan("rust", (ScanModule("r", ("rs/lib.rs",)),), False)

    found = gaps(root, [python_scan("py"), rust], {}, "crap")

    assert [(gap["project"]["language"], gap["line"]) for gap in found] == [
        ("rust", "cargo-llvm-cov is not installed")
    ]


def test_all_sub_projects_fine_reports_no_gaps(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, poetry="echo")
    root = repository(tmp_path)
    poetry_projects(root, "a")

    assert gaps(root, [python_scan("a")], {}, "crap") == []


@pytest.mark.parametrize("setting", [{"test_command": ["true"]}, {"coverage": "lcov.info"}])
def test_a_test_command_or_coverage_setting_gives_no_gaps(setting, monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)
    root = repository(tmp_path)
    (root / "Cargo.toml").write_text("")

    assert gaps(root, [Scan("rust", (), False)], setting, "crap") == []


def test_a_probe_that_times_out_is_a_gap(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, cargo=f"exec {shutil.which('sleep')} 5")
    monkeypatch.setattr(preflight_module, "PREFLIGHT_SECONDS", 1)
    root = repository(tmp_path)
    (root / "Cargo.toml").write_text("")

    found = gaps(root, [Scan("rust", (), False)], {}, "crap")

    assert [gap["line"] for gap in found] == ["did not answer within 1 seconds"]
    assert found[0]["fix"]["kind"] == "outside"


@pytest.mark.skipif(shutil.which("uv") is None, reason="needs uv on PATH")
def test_a_uv_project_with_no_managed_environment_gives_the_uv_sync_gap(tmp_path):
    root = make_repository(tmp_path / "p", {"pyproject.toml": PYPROJECT, "m.py": ""})
    subprocess.run(["uv", "lock", "-q"], cwd=root, check=True, capture_output=True)
    git_commit(root)

    found = gaps(root, [python_scan("")], {}, "crap")

    assert [gap["line"] for gap in found] == ["the project's environment is not set up"]
    assert found[0]["fix"] == {
        "text": "uv sync",
        "command": ["uv", "sync"],
        "cwd": "",
        "env": {"UV_PROJECT_ENVIRONMENT": ".recognizer/cache/python-env"},
        "kind": "repository",
    }
    assert not (root / ".recognizer" / "cache" / "python-env").exists()
