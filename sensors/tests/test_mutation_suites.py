import json
import os
import shlex
import subprocess
import sys
import threading
import time
from dataclasses import asdict

import pytest
from conftest import (
    git_commit,
    make_repository,
    mutate_repository,
    python_suite,
    shim_suite,
)
from test_mutation import RECORD, run_mutate

from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.mutation.record import build_record, command_hash, read_record
from recognizer_sensors.mutation.warmup import coverage_run, selection_dropped
from recognizer_sensors.scans import read_scans
from recognizer_sensors.settings import Refusal, SettingsError
from recognizer_sensors.testrun.suites import parse_suites

MODULE = "def add(a, b):\n    return a + b\n"

TESTS = "from pkg import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n"


def suite_raw(name="api", language="python", directory=".", **extra):
    return {
        "name": name,
        "language": language,
        "directory": directory,
        "command": "true",
        "coverage": {"path": "cov.info", "format": "lcov"},
        **extra,
    }


def work_folders(root):
    return list((root / ".recognizer/cache/mutation").glob("work*"))


def test_mutation_settings_accept_tests_and_carry_and_refuse_test_command_and_coverage():
    parsed = sensor.parse_settings({"tests": [suite_raw()], "carry": ["web/node_modules"]})

    assert parsed["suites"] == [asdict(parse_suites([suite_raw()])[0])]
    assert parsed["carry"] == ("web/node_modules",)

    with pytest.raises(SettingsError, match="unknown setting: test_command"):
        sensor.parse_settings({"test_command": ["pytest"]})

    with pytest.raises(SettingsError, match="unknown setting: coverage"):
        sensor.parse_settings({"coverage": "lcov.info"})


def test_two_suites_with_one_language_and_directory_are_a_settings_error():
    raw = [suite_raw("one"), suite_raw("two")]

    with pytest.raises(SettingsError, match="two test suites run python from \\."):
        sensor.parse_settings({"tests": raw})

    sensor.parse_settings({"tests": [suite_raw("one"), suite_raw("two", directory="service")]})
    sensor.parse_settings({"tests": [suite_raw("one"), suite_raw("two", language="rust")]})


@pytest.mark.parametrize("entry", ["/abs", "../up", "a/../../b"])
def test_a_carry_entry_that_is_absolute_or_leaves_the_repository_is_a_settings_error(entry):
    with pytest.raises(SettingsError):
        sensor.parse_settings({"tests": [suite_raw()], "carry": [entry]})


def test_the_suites_never_depend_on_the_worker_count_and_always_on_their_env():
    one = sensor.parse_settings({"tests": [suite_raw()], "max_workers": 1})
    eight = sensor.parse_settings({"tests": [suite_raw()], "max_workers": 8})
    other = sensor.parse_settings({"tests": [suite_raw(env={"X": "1"})], "max_workers": 1})

    assert sensor.record_key(one["suites"]) == sensor.record_key(eight["suites"])
    assert command_hash(sensor.record_key(one["suites"])) != command_hash(
        sensor.record_key(other["suites"])
    )


def test_a_record_written_with_selection_two_reads_as_none(tmp_path):
    suites = sensor.parse_settings({"tests": [suite_raw()]})["suites"]
    old = build_record({"suites": suites, "selection": 2}, "c", "s", {}, [])
    path = tmp_path / "record.json"
    path.write_text(json.dumps(old))

    assert read_record(path, {"suites": suites, "selection": 2}) is not None
    assert read_record(path, sensor.record_key(suites)) is None


def test_a_file_belongs_to_the_suite_with_the_longest_matching_directory():
    suites = parse_suites([suite_raw("root"), suite_raw("service", directory="service")])

    assert sensor.owner_suite(list(suites), "service/a.py").name == "service"
    assert sensor.owner_suite(list(suites), "other/b.py").name == "root"
    assert sensor.owner_suite(list(suites)[1:], "other/b.py") is None
    assert sensor.owner_suite(list(suites)[1:], "service").name == "service"


def two_languages(tmp_path):
    root = make_repository(
        tmp_path / "r",
        {
            "app/m.py": "def f(a):\n    return a + 1\n",
            "web/a.ts": "export function a(x: number) { return x + 1; }\n",
        },
    )
    (root / "cov.info").write_text("SF:app/m.py\nDA:1,1\nDA:2,1\nend_of_record\n")
    commit = git_commit(root)

    return root, commit


def run_sensor(root, tmp_path, settings, commit):
    return run_mutate(root, tmp_path / "overlay.json", json.dumps(settings), "--commit", commit)


def python_only_suite(tmp_path):
    body = f"{shlex.quote(sys.executable)} -c pass"

    return shim_suite(
        body, command="touch cov.info #", coverage={"path": "cov.info", "format": "lcov"}
    )


def test_a_language_with_no_suite_is_not_measured_and_says_so(tmp_path, capsys):
    root, commit = two_languages(tmp_path)
    settings = {"tests": [python_only_suite(tmp_path)], "max_workers": 1}

    assert run_sensor(root, tmp_path, settings, commit) == 0

    overlay = json.loads((root / ".recognizer/cache/overlays/mutation.json").read_text())

    assert "no test suite is configured for typescript; its files are not measured" in (
        capsys.readouterr().err
    )
    assert all(not key.startswith("web/") for key in overlay["values"]["killed"])
    assert any(key.startswith("app/") for key in overlay["values"]["killed"])


def test_no_suite_for_any_scanned_language_refuses_with_coverage_unavailable(tmp_path, capsys):
    root, commit = two_languages(tmp_path)
    (root / ".recognizer/cache/scan.python.json").unlink()
    settings = {"tests": [python_only_suite(tmp_path)]}

    assert run_sensor(root, tmp_path, settings, commit) == 2

    lines = capsys.readouterr().err.splitlines()
    reason = json.loads(lines[0].removeprefix("recognizer-reason "))

    assert reason["code"] == "coverage-unavailable"
    assert lines[-1] == "coverage unavailable: no test suite is configured for typescript"
    assert work_folders(root) == []


def test_no_tests_list_refuses_with_the_crap_sentence(tmp_path, capsys):
    root, commit = two_languages(tmp_path)

    assert run_sensor(root, tmp_path, {}, commit) == 2
    assert capsys.readouterr().err.splitlines()[-1] == (
        "coverage unavailable: no test suites are configured; "
        "add a tests list to .recognizer/config.yaml"
    )


RECORDER = """#!/bin/sh
{
  pwd
  echo "$MARKER"
  echo "$@"
} >> "$RECORD_FILE"
exit ${PYTEST_STATUS:-0}
"""


def install_shim(folder, name, body):
    folder.mkdir(exist_ok=True)
    path = folder / name
    path.write_text(body)
    path.chmod(0o755)

    return folder


def test_a_mutant_runs_in_the_suite_directory_of_its_copy_under_the_login_shell_and_env(
    tmp_path, monkeypatch
):
    root = make_repository(
        tmp_path / "r",
        {"service/m.py": "def f(a):\n    return a + 1\n", "service/cov.info": ""},
    )
    (root / "service/cov.info").write_text("SF:m.py\nDA:1,1\nDA:2,1\nend_of_record\n")
    commit = git_commit(root)
    shims = install_shim(tmp_path / "shims", "pytest", RECORDER)
    record = tmp_path / "record.txt"
    suite = suite_raw(
        directory="service",
        activate=(
            f'export PATH={shims}:$PATH RECORD_FILE={record}; echo "$-" >> {tmp_path / "flags.txt"}'
        ),
        command="touch cov.info #",
        env={"MARKER": "from-env"},
    )

    assert run_sensor(root, tmp_path, {"tests": [suite], "max_workers": 1}, commit) == 0

    lines = record.read_text().splitlines()
    cwds = lines[0::3]
    markers = lines[1::3]
    flags = (tmp_path / "flags.txt").read_text().splitlines()

    assert cwds and all(cwd.endswith("/service") for cwd in cwds)
    assert all("/work/" in cwd for cwd in cwds)
    assert set(markers) == {"from-env"}
    assert all("i" in flag for flag in flags)


SLEEPER = """#!/bin/sh
sleep 60 &
echo $! > "$PID_FILE"
wait
"""


def sleeping_suite(tmp_path):
    shims = install_shim(tmp_path / "shims", "sleeper", SLEEPER)
    pid_file = tmp_path / "child.pid"
    suite = parse_suites(
        [suite_raw(activate=f"export PATH={shims}:$PATH PID_FILE={pid_file}", command="sleeper")]
    )[0]

    return suite, pid_file


def gone(pid):
    deadline = time.monotonic() + 10

    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True

        time.sleep(0.05)

    return False


def test_a_timed_out_mutant_run_leaves_no_child_running(tmp_path):
    suite, pid_file = sleeping_suite(tmp_path)

    result = runner.run_test_command(["sleeper"], tmp_path, 1.0, suite=suite)
    pid = int(pid_file.read_text())

    assert result.timed_out
    assert gone(pid)


def test_a_stop_leaves_no_child_running(tmp_path):
    suite, pid_file = sleeping_suite(tmp_path)
    results = []

    thread = threading.Thread(
        target=lambda: results.append(
            runner.run_test_command(["sleeper"], tmp_path, None, suite=suite)
        )
    )
    thread.start()
    deadline = time.monotonic() + 20

    while not pid_file.exists() and time.monotonic() < deadline:
        time.sleep(0.05)

    pid = int(pid_file.read_text())

    try:
        runner.stop_all()
        thread.join(30)
    finally:
        runner.STOP.clear()

    assert not thread.is_alive()
    assert gone(pid)


def test_the_mutation_sensor_loads_none_of_the_removed_modules():
    code = (
        "import recognizer_sensors.mutation.sensor, recognizer_sensors.crap.sensor, sys;"
        "print([m for m in sys.modules if m.startswith('recognizer_sensors.testrun.')"
        " and m.rsplit('.',1)[1] in ('projects','profiles','probes','preflight','run')])"
    )
    done = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True)

    assert done.stdout.strip() == "[]"


def editable_repository(tmp_path, extra_files=None):
    root = make_repository(
        tmp_path / "repo",
        {"src/pkg/__init__.py": MODULE, "tests/test_add.py": TESTS, **(extra_files or {})},
    )
    venv = tmp_path / "venv"
    subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True, capture_output=True)
    [site_packages] = (venv / "lib").glob("python*/site-packages")
    outer = subprocess.run(
        [sys.executable, "-c", "import site; print(site.getsitepackages()[0])"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    (site_packages / "outer.pth").write_text(f"{outer}\n")
    (site_packages / "pkg.pth").write_text(f"{root / 'src'}\n")
    git_commit(root)

    return root, venv


def editable_suite(venv, log, **extra):
    python = shlex.quote(str(venv / "bin" / "python"))
    pytest_args = "-q -p no:cacheprovider"

    return suite_raw(
        activate=(
            f"pytest() {{ echo run >> {shlex.quote(str(log))}; "
            f'{python} -m pytest {pytest_args} "$@"; }}'
        ),
        command=(f"{python} -m pytest {pytest_args} --cov=pkg --cov-report=lcov:cov.info"),
        **extra,
    )


def run_editable(root, suite, tmp_path):
    return run_mutate(
        root,
        tmp_path / "overlay.json",
        json.dumps({"tests": [suite], "max_workers": 1}),
        "--commit",
        git_commit_hash(root),
    )


def git_commit_hash(root):
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()


def test_an_editable_install_refuses_before_any_mutant_and_names_the_original_path(
    tmp_path, capsys
):
    pytest.importorskip("pytest_cov")
    root, venv = editable_repository(tmp_path)
    log = tmp_path / "mutant-runs.log"

    assert run_editable(root, editable_suite(venv, log), tmp_path) == 2

    err = capsys.readouterr().err
    reason = err.splitlines()[-1]

    assert f"{(root / 'src/pkg/__init__.py').resolve()}" in reason
    assert "PYTHONPATH" in reason
    assert "pytest's" not in reason
    assert reason.startswith("coverage unavailable:")
    assert not log.exists()
    assert work_folders(root) == []
    assert not (root / ".recognizer/cache/mutation/python-env").exists()


def test_pythonpath_in_the_suite_env_makes_the_mutated_copy_the_one_imported(tmp_path):
    pytest.importorskip("pytest_cov")
    root, venv = editable_repository(tmp_path)
    log = tmp_path / "mutant-runs.log"
    suite = editable_suite(venv, log, env={"PYTHONPATH": "src"})

    assert run_editable(root, suite, tmp_path) == 0

    overlay = json.loads((root / ".recognizer/cache/overlays/mutation.json").read_text())

    assert overlay["values"]["killed"]["src/pkg/__init__.py::add"] == 1
    assert overlay["values"]["survived"]["src/pkg/__init__.py::add"] == 0
    assert log.exists()


def test_pytest_pythonpath_makes_the_mutated_copy_the_one_imported(tmp_path):
    pytest.importorskip("pytest_cov")
    root, venv = editable_repository(
        tmp_path, {"pyproject.toml": '[tool.pytest.ini_options]\npythonpath = ["src"]\n'}
    )
    log = tmp_path / "mutant-runs.log"

    assert run_editable(root, editable_suite(venv, log), tmp_path) == 0

    overlay = json.loads((root / ".recognizer/cache/overlays/mutation.json").read_text())

    assert overlay["values"]["killed"]["src/pkg/__init__.py::add"] == 1


def test_a_mixed_report_names_only_the_path_outside_the_copy(tmp_path):
    from recognizer_sensors.mutation.warmup import outside_the_copy

    root = tmp_path / "repo"
    copy = root / ".recognizer/cache/mutation/work/x/warmup"
    copy.mkdir(parents=True)
    report = tmp_path / "cov.info"
    report.write_text(
        f"SF:{copy}/src/inside.py\n"
        f"SF:{root}/src/outside.py\n"
        f"SF:{root}/.venv/lib/python3.11/site-packages/dep/x.py\n"
        "SF:src/relative.py\n"
    )

    assert outside_the_copy(copy, root, [report]) == f"{root.resolve()}/src/outside.py"


def ts_world(tmp_path, runner_name):
    root = make_repository(
        tmp_path / "r",
        {
            "src/a.ts": "export function a(x: number) { return x + 1; }\n",
            "src/b.ts": "export function b(x: number) { return x + 1; }\n",
        },
    )
    (root / "cov.info").write_text(
        "SF:src/a.ts\nDA:1,1\nend_of_record\nSF:src/b.ts\nDA:1,1\nend_of_record\n"
    )
    git_commit(root)
    log = tmp_path / "npx.log"
    miss = (
        'case "$*" in *"related src/a.ts"*) echo "No affected test files found, exiting with code 0";; esac'
        if runner_name == "vitest"
        else 'case "$*" in *"--findRelatedTests src/a.ts"*) echo "0 matches"; return 1;; esac'
    )
    shim = f'npx() {{ echo "$*" >> {shlex.quote(str(log))}; {miss}; return 0; }}'
    suite = suite_raw(
        language="typescript",
        runner=runner_name,
        activate=shim,
        command="touch cov.info #",
    )

    return root, suite, log


@pytest.mark.parametrize("runner_name", ["vitest", "jest"])
def test_a_runner_that_finds_no_test_for_a_file_runs_the_whole_suite_for_that_file_only(
    tmp_path, runner_name, capsys
):
    root, suite, log = ts_world(tmp_path, runner_name)

    assert run_sensor(root, tmp_path, {"tests": [suite], "max_workers": 1}, "c1") == 0

    ran = log.read_text().splitlines()
    related = (
        "related src/{}.ts --run" if runner_name == "vitest" else "--findRelatedTests src/{}.ts"
    )
    whole = "--no -- vitest run" if runner_name == "vitest" else "--no -- jest"

    assert any(related.format("b") in line and "--bail" in line for line in ran)
    assert not any(related.format("a") in line and "--bail" in line for line in ran)
    assert any(line.startswith(whole) and "--bail" in line for line in ran)
    assert "the selected test command for src/a.ts:" in capsys.readouterr().err


def test_typescript_commands_come_from_the_suites_runner_through_npx_without_downloads(tmp_path):
    root, suite, log = ts_world(tmp_path, "vitest")

    assert run_sensor(root, tmp_path, {"tests": [suite], "max_workers": 1}, "c1") == 0
    assert all(line.startswith("--no --") for line in log.read_text().splitlines())


def test_kotlin_outside_the_root_and_a_language_with_two_suites_run_the_whole_suite(capsys):
    root_suite = parse_suites([suite_raw("a", "kotlin", "app")])
    two = parse_suites([suite_raw("a", "kotlin", "a"), suite_raw("b", "kotlin", "b")])

    assert selection_dropped("kotlin", list(root_suite)) == {}
    assert selection_dropped("kotlin", list(two)) == {}

    err = capsys.readouterr().err.splitlines()

    assert err == [
        "recognizer-sensors: mutation: kotlin runs from app; running the whole suite for kotlin",
        "recognizer-sensors: mutation: kotlin has 2 suites; running the whole suite for kotlin",
    ]


@pytest.mark.parametrize("outcome", ["finished", "red", "stopped_by_the_refusal"])
def test_no_run_leaves_a_work_folder_or_a_python_env_behind(tmp_path, outcome):
    root, _ = mutate_repository(tmp_path)
    script = "tests/strong.py" if outcome == "finished" else "tests/weak.py"
    suite = python_suite(script)

    if outcome == "red":
        suite = python_suite("tests/no_such_script.py")

    if outcome == "stopped_by_the_refusal":
        suite["command"] = "false #"

    status = run_mutate(root, tmp_path / "overlay.json", json.dumps({"tests": [suite]}))

    assert (status == 0) == (outcome == "finished")
    assert work_folders(root) == []
    assert not (root / ".recognizer/cache/mutation/python-env").exists()
    assert (root / RECORD).exists() == (outcome == "finished")


def test_a_coverage_run_that_exits_non_zero_refuses_even_with_a_report(tmp_path):
    root, _ = mutate_repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    suites = parse_suites(
        [
            suite_raw(
                command="touch coverage/lcov.info; exit 3 #",
                coverage={"path": "coverage/lcov.info", "format": "lcov"},
            )
        ]
    )
    scans = [scan for scan in read_scans(root) if scan.language == "python"]

    with pytest.raises(Refusal) as refusal:
        coverage_run(root, scans, suites, work)

    assert refusal.value.diagnosis["code"] == "tests-failed"
