import json
import shutil
import stat
import subprocess
import sys

import pytest
from conftest import REPOSITORY

from recognizer_sensors.scans import Scan
from recognizer_sensors.testrun import profiles
from recognizer_sensors.testrun.probes import Probe, names_jacoco, probe
from recognizer_sensors.testrun.run import collect_coverage

pytestmark = pytest.mark.real_probes


def scan(language):
    return Scan(language, (), False)


def shim(directory, name, text):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(f"#!/bin/sh\n{text}\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def only_path(monkeypatch, tmp_path, **shims):
    git = shutil.which("git")
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir(exist_ok=True)
    shim(bin_directory, "git", f'exec {git} "$@"')

    for name, text in shims.items():
        shim(bin_directory, name, text)

    monkeypatch.setenv("PATH", str(bin_directory))
    monkeypatch.delenv("JAVA_HOME", raising=False)

    return bin_directory


def repository(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()

    return root


def result(language, root):
    return probe(root, [scan(language)], {})


def test_a_uv_repository_without_uv_names_uv(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)
    root = repository(tmp_path)
    (root / "uv.lock").write_text("")
    found = result("python", root)

    assert found.diagnosis == {
        "code": "tool-missing",
        "line": "uv is not installed; install it with brew install uv",
        "fix": "brew install uv",
    }


@pytest.mark.parametrize(
    ("absent", "borrowed"),
    [
        ("coverage pytest", ["--with", "coverage", "--with", "pytest"]),
        ("coverage", ["--with", "coverage"]),
        ("pytest", ["--with", "pytest"]),
        ("", []),
    ],
)
def test_a_uv_repository_borrows_only_the_modules_its_environment_lacks(
    absent, borrowed, monkeypatch, tmp_path
):
    only_path(monkeypatch, tmp_path, uv=f'echo "{absent}"')
    root = repository(tmp_path)
    (root / "uv.lock").write_text("")
    found = result("python", root)

    assert found.diagnosis is None
    assert found.borrowed == borrowed


def test_the_borrowed_modules_reach_the_uv_runner_and_leave_other_runners_alone(
    monkeypatch, tmp_path
):
    root = repository(tmp_path)
    (root / "uv.lock").write_text("")
    monkeypatch.setattr(profiles, "PYTHON_BORROWED", ["--with", "coverage"])

    assert profiles.python_runner(root) == ["uv", "run", "--with", "coverage"]

    (root / "uv.lock").unlink()

    assert profiles.python_runner(root) == ["python3", "-m"]


def test_a_poetry_repository_missing_modules_names_the_fix(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, poetry='echo "coverage pytest"')
    root = repository(tmp_path)
    (root / "poetry.lock").write_text("")
    found = result("python", root)

    assert found.diagnosis["line"] == (
        "coverage and pytest are not installed; install them with "
        "poetry add --group dev coverage pytest"
    )
    assert found.diagnosis["fix"] == "poetry add --group dev coverage pytest"


def test_a_poetry_repository_without_poetry_names_poetry(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)
    root = repository(tmp_path)
    (root / "poetry.lock").write_text("")

    assert result("python", root).diagnosis["fix"] == "brew install poetry"


def test_a_plain_python_repository_names_the_one_missing_module(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, python3='echo "pytest"')
    found = result("python", repository(tmp_path))

    assert found.diagnosis == {
        "code": "tool-missing",
        "line": "pytest is not installed; install it with python3 -m pip install pytest",
        "fix": "python3 -m pip install pytest",
    }


def test_a_plain_python_repository_with_both_modules_passes(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, python3="echo")

    assert result("python", repository(tmp_path)).diagnosis is None


def test_a_probe_that_cannot_answer_does_not_refuse(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, python3="exit 3")

    assert result("python", repository(tmp_path)).diagnosis is None


def test_typescript_without_npm_names_node(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)

    assert result("typescript", repository(tmp_path)).diagnosis == {
        "code": "tool-missing",
        "line": "npm is not installed; install it with brew install node",
        "fix": "brew install node",
    }


def typescript_repository(monkeypatch, tmp_path, package):
    only_path(monkeypatch, tmp_path, npm="", npx="")
    root = repository(tmp_path)
    (root / "package.json").write_text(json.dumps(package))

    return root


def test_typescript_without_a_test_script_names_the_script(monkeypatch, tmp_path):
    root = typescript_repository(monkeypatch, tmp_path, {"name": "x"})

    assert result("typescript", root).diagnosis == {
        "code": "tool-missing",
        "line": "package.json has no test script; add a test script to package.json",
        "fix": "add a test script to package.json",
    }


def test_typescript_with_dependencies_and_no_install_names_npm_install(monkeypatch, tmp_path):
    root = typescript_repository(
        monkeypatch, tmp_path, {"scripts": {"test": "vitest"}, "devDependencies": {"vitest": "1"}}
    )

    assert result("typescript", root).diagnosis == {
        "code": "tool-missing",
        "line": "dependencies are not installed; install them with npm install",
        "fix": "npm install",
    }


def test_typescript_with_node_modules_or_no_dependencies_passes(monkeypatch, tmp_path):
    root = typescript_repository(
        monkeypatch, tmp_path, {"scripts": {"test": "vitest"}, "devDependencies": {"vitest": "1"}}
    )
    (root / "node_modules").mkdir()

    assert result("typescript", root).diagnosis is None

    (root / "package.json").write_text(json.dumps({"scripts": {"test": "node t.js"}}))
    (root / "node_modules").rmdir()

    assert result("typescript", root).diagnosis is None


def gradle_repository(tmp_path, build):
    root = repository(tmp_path)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    (root / "gradlew").write_text("#!/bin/sh\n")
    (root / "gradlew").chmod(0o755)
    (root / "build.gradle.kts").write_text(build)

    return root


def test_kotlin_without_a_wrapper_names_the_wrapper(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, java="")
    root = repository(tmp_path)
    (root / "build.gradle.kts").write_text('id("jacoco")')

    assert result("kotlin", root).diagnosis == {
        "code": "tool-missing",
        "line": "gradlew is missing or not executable; add the Gradle wrapper with gradle wrapper",
        "fix": "gradle wrapper",
    }


def test_kotlin_without_java_names_java(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)
    root = gradle_repository(tmp_path, 'id("jacoco")')

    assert result("kotlin", root).diagnosis["fix"] == "brew install openjdk"


def test_kotlin_accepts_java_home_in_place_of_java_on_the_path(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)
    monkeypatch.setenv("JAVA_HOME", "/opt/java")
    root = gradle_repository(tmp_path, 'id("jacoco")')

    assert result("kotlin", root).diagnosis is None


def test_kotlin_without_jacoco_names_the_plugin(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, java="")
    root = gradle_repository(tmp_path, "plugins {}")

    assert result("kotlin", root).diagnosis == {
        "code": "tool-missing",
        "line": 'jacoco is not configured; apply the jacoco plugin: id("jacoco")',
        "fix": 'apply the jacoco plugin: id("jacoco")',
    }


def test_the_jacoco_text_probe_reads_the_committed_fixtures():
    mutation = REPOSITORY / "fixtures" / "mutation" / "kotlin"
    scan_only = REPOSITORY / "fixtures" / "kotlin" / "sample" / "app"

    assert names_jacoco(mutation, "build.gradle.kts")
    assert not names_jacoco(scan_only, "build.gradle.kts")


def test_rust_without_cargo_names_cargo(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)

    assert result("rust", repository(tmp_path)).diagnosis["fix"] == "brew install rustup"


def test_rust_without_llvm_cov_gives_the_brief_example(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, cargo="exit 1")

    assert result("rust", repository(tmp_path)).diagnosis == {
        "code": "tool-missing",
        "line": "cargo-llvm-cov is not installed; install it with cargo install cargo-llvm-cov",
        "fix": "cargo install cargo-llvm-cov",
    }


def test_rust_with_llvm_cov_passes(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path, cargo='echo "cargo-llvm-cov 0.9.1"')

    assert result("rust", repository(tmp_path)).diagnosis is None


def test_a_setting_that_replaces_the_tool_skips_its_probe(monkeypatch, tmp_path):
    only_path(monkeypatch, tmp_path)
    root = repository(tmp_path)

    assert probe(root, [scan("rust")], {"test_command": ["x"]}).diagnosis is None
    assert probe(root, [scan("rust")], {"coverage": "x.info"}).diagnosis is None


def test_a_missing_tool_leaves_complexity_alone_for_the_sensor_that_records_it(
    monkeypatch, tmp_path
):
    only_path(monkeypatch, tmp_path, cargo="exit 1")
    root = repository(tmp_path)
    diagnoses = []

    assert collect_coverage(root, [scan("rust")], None, None, diagnoses) == {}
    assert diagnoses == [
        {
            "code": "coverage-unavailable",
            "line": "coverage unavailable: cargo-llvm-cov is not installed; "
            "install it with cargo install cargo-llvm-cov",
            "fix": "cargo install cargo-llvm-cov",
        }
    ]
    assert not (root / ".recognizer").exists()


@pytest.mark.parametrize(
    ("log", "fix"),
    [
        ("error: failed to find llvm-tools-preview", "rustup component add llvm-tools-preview"),
        ("npm error network request failed", "check the network, c8 is fetched by npx"),
    ],
)
def test_a_known_log_signature_with_no_report_names_its_fix(log, fix, tmp_path, monkeypatch):
    monkeypatch.setattr("recognizer_sensors.testrun.run.probe", lambda *args: Probe())
    root = repository(tmp_path)
    command = [sys.executable, "-c", f"import sys; print({log!r}); sys.exit(1)"]
    diagnoses = []

    collect_coverage(root, [scan("rust")], command, None, diagnoses)

    assert diagnoses[-1]["code"] == "coverage-unavailable"
    assert diagnoses[-1]["fix"] == fix


def test_an_unknown_failure_with_no_report_points_at_the_log(tmp_path):
    root = repository(tmp_path)
    command = [sys.executable, "-c", "import sys; sys.exit(1)"]
    diagnoses = []

    collect_coverage(root, [scan("rust")], command, None, diagnoses)

    assert "fix" not in diagnoses[-1]
    assert ".recognizer/cache/coverage/last-run.log" in diagnoses[-1]["line"]
