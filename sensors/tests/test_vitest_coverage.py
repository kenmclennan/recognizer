import json
import subprocess

import pytest
from test_mutation_selection import fake_c8, typescript_repository

from recognizer_sensors.scans import read_scans
from recognizer_sensors.testrun import probes, profiles
from recognizer_sensors.testrun.projects import Project
from recognizer_sensors.testrun.run import collect_coverage_with_tests

VERSION = "3.2.7"

FLAGS = [
    "--coverage.enabled",
    "--coverage.provider=v8",
    "--coverage.reporter=lcovonly",
]


def write_package(folder, script="vitest run"):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "package.json").write_text(
        json.dumps({"scripts": {"test": script}, "devDependencies": {"vitest": "3"}})
    )


def install(folder, vitest=True, coverage=True):
    modules = folder / "node_modules"
    modules.mkdir(parents=True, exist_ok=True)

    if vitest:
        (modules / "vitest").mkdir()
        (modules / "vitest" / "package.json").write_text(json.dumps({"version": VERSION}))

    if coverage:
        (modules / "@vitest" / "coverage-v8").mkdir(parents=True)
        (modules / "@vitest" / "coverage-v8" / "package.json").write_text(
            json.dumps({"version": VERSION})
        )


def vitest_repository(tmp_path, coverage=True):
    write_package(tmp_path)
    install(tmp_path, coverage=coverage)

    return tmp_path


def walk(root):
    return sorted(str(p.relative_to(root)) for p in (root / "node_modules").rglob("*"))


@pytest.fixture(autouse=True)
def tools_on_path(monkeypatch):
    monkeypatch.setattr(probes.shutil, "which", lambda name: f"/usr/bin/{name}")


@pytest.mark.parametrize(
    ("script", "expected"),
    [
        ("vitest run", "vitest"),
        ("vitest", "vitest"),
        ("jest --ci", "jest"),
        ("cross-env CI=1 vitest", None),
        ("npm run unit", None),
        ("", None),
    ],
)
def test_typescript_runner_is_the_first_word_when_jest_or_vitest(tmp_path, script, expected):
    write_package(tmp_path, script)

    assert profiles.typescript_runner(tmp_path) == expected


def test_typescript_runner_is_none_for_an_unreadable_package_json(tmp_path):
    (tmp_path / "package.json").write_text("{")

    assert profiles.typescript_runner(tmp_path) is None


def test_a_vitest_project_collects_whole_suite_coverage_through_npm_test(tmp_path):
    root = vitest_repository(tmp_path)

    command = profiles.coverage_command(root, "typescript")

    assert command[:3] == ["npm", "test", "--"]
    assert command[3:] == [
        *FLAGS,
        "--coverage.reportsDirectory=.recognizer/cache/coverage/typescript",
    ]
    assert not {"sh", "install", "ln"} & set(command)


def test_no_command_or_probe_writes_into_node_modules(tmp_path):
    for coverage in (True, False):
        root = vitest_repository(tmp_path / str(coverage), coverage=coverage)
        before = walk(root)

        commands = [
            profiles.coverage_command(root, "typescript"),
            profiles.by_file_command(root, "a.test.ts", 1),
        ]
        probes.probe_typescript(root)

        assert walk(root) == before

        for command in commands:
            assert not {"install", "ln"} & set(command)
            assert not any("node_modules" in word for word in command)


def test_a_missing_add_on_is_a_tool_missing_diagnosis_and_coverage_does_not_fall_back(tmp_path):
    root = vitest_repository(tmp_path, coverage=False)

    found = probes.probe_typescript(root)

    assert found.diagnosis == {
        "code": "tool-missing",
        "line": "@vitest/coverage-v8 is not installed",
        "fix": f"npm install --save-dev @vitest/coverage-v8@{VERSION}",
    }
    assert profiles.coverage_command(root, "typescript")[:3] == ["npm", "test", "--"]


def test_the_add_on_present_or_a_jest_script_has_no_diagnosis(tmp_path):
    assert probes.probe_typescript(vitest_repository(tmp_path / "a")).diagnosis is None

    write_package(tmp_path / "b", "jest")
    install(tmp_path / "b", coverage=False)

    assert probes.probe_typescript(tmp_path / "b").diagnosis is None


def test_the_per_file_command_runs_one_file_into_a_numbered_folder(tmp_path):
    root = vitest_repository(tmp_path)

    command = profiles.by_file_command(root, "web/a.test.ts", 3)

    assert command[-1] == "web/a.test.ts"
    assert "--coverage.reportsDirectory=.recognizer/cache/coverage/typescript/by-file/3" in command


def test_a_repository_without_package_json_keeps_the_c8_per_file_command(tmp_path):
    expected = list(profiles.PROFILES["typescript"]["coverage_command"])
    expected[expected.index("--reports-dir") + 1] = (
        ".recognizer/cache/coverage/typescript/by-file/2"
    )

    assert profiles.by_file_command(tmp_path, "a.test.ts", 2) == [*expected, "--", "a.test.ts"]


@pytest.mark.parametrize("script", ["vitest run", "jest"])
def test_a_project_without_installed_vitest_or_running_jest_keeps_c8(tmp_path, script):
    write_package(tmp_path, script)
    install(tmp_path, vitest=script == "jest", coverage=False)

    assert (
        profiles.coverage_command(tmp_path, "typescript")
        == profiles.PROFILES["typescript"]["coverage_command"]
    )


def test_a_repository_without_package_json_keeps_the_c8_coverage_command(tmp_path):
    assert (
        profiles.coverage_command(tmp_path, "typescript")
        == profiles.PROFILES["typescript"]["coverage_command"]
    )


def test_a_project_directory_finds_vitest_in_an_ancestor_and_names_its_directory(tmp_path):
    write_package(tmp_path / "web")
    install(tmp_path, coverage=False)
    project = Project("typescript", "web", "web")

    command = profiles.coverage_command(tmp_path, "typescript", project=project)

    assert command[-1] == (
        f"--coverage.reportsDirectory={tmp_path}/.recognizer/cache/coverage/projects/web/typescript"
    )

    found = probes.named_in(probes.probe_typescript(tmp_path, "web"), project)

    assert found.diagnosis["line"] == "web/: @vitest/coverage-v8 is not installed"

    install(tmp_path, vitest=False)

    assert probes.probe_typescript(tmp_path, "web").diagnosis is None


def fake_vitest(root, failing=None):
    real = subprocess.run
    reports = {
        "0": "SF:web/lib.ts\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n",
        "1": "SF:web/lib.ts\nDA:1,1\nDA:2,0\nDA:3,1\nend_of_record\n",
    }

    def fake(command, **kwargs):
        if command[0] == "git":
            return real(command, **kwargs)

        if command[:3] != ["npm", "test", "--"]:
            raise AssertionError(command)

        prefix = "--coverage.reportsDirectory="
        directory = next(w for w in command if w.startswith(prefix)).removeprefix(prefix)
        by_file = command[-1] if command[-1].endswith(".ts") else None
        body = reports.get(directory.rsplit("/", 1)[-1]) if by_file else None
        body = body or "SF:web/lib.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n"

        if not (by_file and by_file == failing):
            (root / directory).mkdir(parents=True, exist_ok=True)
            (root / directory / "lcov.info").write_text(body)

        return subprocess.CompletedProcess(command, 1 if by_file and by_file == failing else 0)

    return fake


def vitest_typescript_repository(tmp_path):
    root = typescript_repository(tmp_path)
    write_package(root)
    install(root)

    return root


def test_vitest_selection_reads_each_per_file_report(tmp_path, monkeypatch):
    root = vitest_typescript_repository(tmp_path)
    monkeypatch.setattr("recognizer_sensors.testrun.run.subprocess.run", fake_vitest(root))

    _, selection = collect_coverage_with_tests(root, read_scans(root), None)

    assert selection["web/lib.ts"][2] == frozenset({"web/a.test.ts"})
    assert selection["web/lib.ts"][3] == frozenset({"web/b.test.ts"})


def test_one_failing_vitest_per_file_run_drops_typescript_selection_for_the_run(
    tmp_path, monkeypatch, capsys
):
    root = vitest_typescript_repository(tmp_path)
    monkeypatch.setattr(
        "recognizer_sensors.testrun.run.subprocess.run",
        fake_vitest(root, failing="web/b.test.ts"),
    )

    _, selection = collect_coverage_with_tests(root, read_scans(root), None)

    assert selection == {}
    assert "running the whole suite for typescript" in capsys.readouterr().err


def test_an_unreadable_vitest_per_file_report_drops_typescript_selection_for_the_run(
    tmp_path, monkeypatch, capsys
):
    root = vitest_typescript_repository(tmp_path)
    real = fake_vitest(root)

    def fake(command, **kwargs):
        done = real(command, **kwargs)

        if "by-file/1" in " ".join(command):
            (root / ".recognizer/cache/coverage/typescript/by-file/1/lcov.info").unlink()

        return done

    monkeypatch.setattr("recognizer_sensors.testrun.run.subprocess.run", fake)

    _, selection = collect_coverage_with_tests(root, read_scans(root), None)

    assert selection == {}
    assert "no coverage report" in capsys.readouterr().err


def test_a_non_vitest_repository_still_runs_c8_per_file(tmp_path, monkeypatch):
    root = typescript_repository(tmp_path)
    monkeypatch.setattr("recognizer_sensors.testrun.run.subprocess.run", fake_c8(root))

    _, selection = collect_coverage_with_tests(root, read_scans(root), None)

    assert selection["web/lib.ts"][2] == frozenset({"web/a.test.ts"})
