import json
import os
import signal
import subprocess
import sys
import time

import pytest
from conftest import git_commit, make_repository

from recognizer_sensors.cli import main
from recognizer_sensors.scans import read_scans
from recognizer_sensors.testrun.profiles import (
    PROFILES,
    coverage_command,
    mutant_command,
    python_runner,
)
from recognizer_sensors.testrun.run import collect_coverage

LCOV = ".recognizer/cache/coverage/python.lcov"
TS_LCOV = ".recognizer/cache/coverage/typescript/lcov.info"
LOG = ".recognizer/cache/coverage/last-run.log"
OVERLAY = ".recognizer/cache/overlays/crap.json"

WRITE_LCOV = """
import pathlib, sys
target = pathlib.Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text("SF:app/m.py\\nDA:1,1\\nDA:2,1\\nDA:3,0\\nend_of_record\\n")
print("ran")
"""

FAIL = "import sys; print('boom'); sys.exit(int(sys.argv[1]))"

SUMMARY = (
    "print('collecting ...'); print('!!!! Interrupted: 2 errors during collection !!!!'); "
    "print('=' * 20); import sys; sys.exit(2)"
)

SILENT = "import sys; sys.exit(2)"

NOTHING = "print('wrote nothing')"

SLEEP = """
import os, pathlib, sys, time
pathlib.Path(sys.argv[1]).write_text(str(os.getpid()))
time.sleep(60)
"""

BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"


def script(root, name, text):
    path = root / name
    path.write_text(text)

    return str(path)


def repository(tmp_path, files=None):
    root = make_repository(tmp_path / "r", files or {"app/m.py": BODY})
    git_commit(root)

    return root


def crap(root, tmp_path, settings):
    output = tmp_path / "findings.json"
    status = main(
        [
            "crap",
            "--repository",
            str(root),
            "--output",
            str(output),
            "--settings",
            json.dumps(settings),
        ]
    )

    return status, output


def test_the_profile_table_names_every_language_in_order():
    assert list(PROFILES) == ["python", "typescript", "kotlin", "rust", "csharp"]
    assert PROFILES["typescript"]["coverage_command"][:3] == ["npx", "--yes", "c8"]
    assert PROFILES["kotlin"]["coverage_command"] == ["./gradlew", "test", "jacocoTestReport"]
    assert PROFILES["kotlin"]["format"] == "jacoco"
    assert PROFILES["rust"]["coverage_command"][:3] == ["cargo", "llvm-cov", "--lcov"]
    assert PROFILES["python"]["report"] == LCOV
    assert PROFILES["typescript"]["test_command"] == ["npm", "test"]
    assert PROFILES["rust"]["test_command"] == ["cargo", "test"]


@pytest.mark.parametrize(
    ("lockfiles", "runner"),
    [
        (["uv.lock"], ["uv", "run"]),
        (["poetry.lock"], ["poetry", "run"]),
        ([], ["python3", "-m"]),
        (["uv.lock", "poetry.lock"], ["uv", "run"]),
    ],
)
def test_the_python_runner_follows_the_lockfile(tmp_path, lockfiles, runner):
    for name in lockfiles:
        (tmp_path / name).write_text("")

    assert python_runner(tmp_path) == runner

    shell = coverage_command(tmp_path, "python")[2]
    words = " ".join(runner)

    assert f"&& {words} coverage run -m pytest && {words} coverage lcov -o {LCOV}" in shell
    assert shell.startswith("export COVERAGE_FILE=.recognizer/cache/coverage/python.data")
    assert mutant_command(tmp_path, "python") == [*runner, "pytest", "-rfE"]


def test_the_python_profile_command_is_spliced_not_joined(tmp_path):
    assert mutant_command(tmp_path, "typescript") == ["npm", "test"]
    assert coverage_command(tmp_path, "python")[:2] == ["sh", "-c"]


def test_a_test_command_ignores_the_lockfiles(tmp_path):
    root = repository(tmp_path)
    (root / "uv.lock").write_text("")
    writer = script(root, "w.py", WRITE_LCOV)

    status, _ = crap(root, tmp_path, {"test_command": [sys.executable, writer, LCOV]})

    assert status == 0
    assert "uv" not in (root / LOG).read_text().split("\n")[0].split()


def test_one_scanned_language_runs_exactly_its_coverage_command(tmp_path):
    root = repository(tmp_path)
    (root / "marker.py").write_text("")
    scans = read_scans(root)

    assert [s.language for s in scans] == ["python"]
    assert coverage_command(root, "python")[0] == "sh"


def test_test_command_runs_once_and_reads_each_default_report(tmp_path):
    root = repository(tmp_path)
    writer = script(root, "w.py", WRITE_LCOV)

    coverage = collect_coverage(root, read_scans(root), [sys.executable, writer, LCOV], None)

    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}}
    assert (root / LOG).read_text().count("== test command") == 1


def test_coverage_alone_runs_nothing_and_reads_the_file(tmp_path):
    root = repository(tmp_path, {"app/m.py": BODY, "cov/lcov.info": "SF:app/m.py\nDA:1,2\n"})

    coverage = collect_coverage(root, read_scans(root), None, "cov/lcov.info")

    assert coverage == {"app/m.py": {1: 2}}
    assert not (root / LOG).exists()


def test_coverage_with_test_command_runs_then_reads(tmp_path):
    root = repository(tmp_path)
    writer = script(root, "w.py", WRITE_LCOV)

    coverage = collect_coverage(
        root, read_scans(root), [sys.executable, writer, "out/c.info"], "out/c.info"
    )

    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}}


def test_no_scan_runs_nothing(tmp_path):
    root = tmp_path / "bare"
    root.mkdir()

    assert collect_coverage(root, [], None, None) == {}


def test_an_xml_coverage_file_is_read_as_jacoco(tmp_path):
    report = (
        '<report><package name="app"><sourcefile name="m.py">'
        '<line nr="1" mi="0" ci="3"/></sourcefile></package></report>'
    )
    root = repository(tmp_path, {"app/m.py": BODY, "cov/jacoco.xml": report})

    assert collect_coverage(root, read_scans(root), None, "cov/jacoco.xml") == {"app/m.py": {1: 3}}


def sentence(capsys):
    return capsys.readouterr().err


def test_a_failing_command_is_one_sentence_and_writes_nothing(tmp_path, capsys):
    root = repository(tmp_path)
    failing = script(root, "f.py", FAIL)

    status, output = crap(root, tmp_path, {"test_command": [sys.executable, failing, "1"]})

    assert status == 2
    assert sentence(capsys) == f"the test command exited 1: boom (see {LOG})\n"
    assert not output.exists()
    assert not (root / OVERLAY).exists()
    assert "boom" in (root / LOG).read_text()


def test_a_failing_command_reports_its_summary_line_and_the_log_path(tmp_path, capsys):
    root = repository(tmp_path)
    failing = script(root, "f.py", SUMMARY)

    status, _ = crap(root, tmp_path, {"test_command": [sys.executable, failing]})

    assert status == 2
    assert sentence(capsys) == (
        f"the test command exited 2: Interrupted: 2 errors during collection (see {LOG})\n"
    )


def test_a_failing_command_with_no_output_reports_the_bare_sentence_and_the_log_path(
    tmp_path, capsys
):
    root = repository(tmp_path)
    failing = script(root, "f.py", SILENT)

    status, _ = crap(root, tmp_path, {"test_command": [sys.executable, failing]})

    assert status == 2
    assert sentence(capsys) == f"the test command exited 2 (see {LOG})\n"


def test_a_long_last_line_is_capped_to_one_line(tmp_path, capsys):
    root = repository(tmp_path)
    failing = script(root, "f.py", "import sys; print('x' * 500); sys.exit(2)")

    crap(root, tmp_path, {"test_command": [sys.executable, failing]})

    assert sentence(capsys) == f"the test command exited 2: {'x' * 200} (see {LOG})\n"


def test_a_failing_run_leaves_a_prior_overlay_untouched(tmp_path):
    root = repository(tmp_path)
    writer = script(root, "w.py", WRITE_LCOV)
    failing = script(root, "f.py", FAIL)

    assert crap(root, tmp_path, {"test_command": [sys.executable, writer, LCOV]})[0] == 0

    before = (root / OVERLAY).read_bytes()

    assert crap(root, tmp_path, {"test_command": [sys.executable, failing, "1"]})[0] == 2
    assert (root / OVERLAY).read_bytes() == before


def test_a_command_that_does_not_start_names_the_program(tmp_path, capsys):
    root = repository(tmp_path)

    status, _ = crap(root, tmp_path, {"test_command": ["/no/such/program"]})

    assert status == 2
    assert sentence(capsys) == "the test command did not start: /no/such/program\n"


def test_a_command_that_leaves_no_report_names_the_path(tmp_path, capsys):
    root = repository(tmp_path)
    nothing = script(root, "n.py", NOTHING)

    status, _ = crap(root, tmp_path, {"test_command": [sys.executable, nothing]})

    assert status == 2
    assert sentence(capsys) == f"the test command left no coverage report: {LCOV}\n"


def test_a_missing_coverage_file_with_no_command_has_its_own_sentence(tmp_path, capsys):
    root = repository(tmp_path)

    status, _ = crap(root, tmp_path, {"coverage": "coverage/lcov.info"})

    assert status == 2
    assert sentence(capsys) == "the coverage file is missing: coverage/lcov.info\n"


def two_languages(tmp_path):
    root = repository(
        tmp_path,
        {"app/m.py": BODY, "web/a.ts": "export function a(x: number) { return x; }\n"},
    )

    return root


def test_two_languages_run_in_order_and_stop_at_the_first_failure(tmp_path, capsys, monkeypatch):
    root = two_languages(tmp_path)
    calls = []

    real = subprocess.run

    def fake(command, **kwargs):
        if command[0] not in ("sh", "npx"):
            return real(command, **kwargs)

        calls.append(command[0])
        kwargs["stdout"].write("out\n")

        if command[0] == "npx":
            return subprocess.CompletedProcess(command, 3)

        (root / LCOV).parent.mkdir(parents=True, exist_ok=True)
        (root / LCOV).write_text("SF:app/m.py\nDA:1,1\nend_of_record\n")

        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr("recognizer_sensors.testrun.run.subprocess.run", fake)

    status, output = crap(root, tmp_path, {})

    assert calls == ["sh", "npx"]
    assert status == 2
    assert sentence(capsys) == f"the typescript test command exited 3: out (see {LOG})\n"
    assert not output.exists()
    assert not (root / OVERLAY).exists()

    log = (root / LOG).read_text()

    assert log.index("== python") < log.index("== typescript")


def test_two_languages_merge_their_reports_by_path(tmp_path, monkeypatch):
    root = two_languages(tmp_path)

    real = subprocess.run

    def fake(command, **kwargs):
        if command[0] not in ("sh", "npx"):
            return real(command, **kwargs)

        target, body = (
            (LCOV, "SF:app/m.py\nDA:1,1\nend_of_record\n")
            if command[0] == "sh"
            else (TS_LCOV, "SF:web/a.ts\nDA:1,0\nend_of_record\n")
        )
        (root / target).parent.mkdir(parents=True, exist_ok=True)
        (root / target).write_text(body)

        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr("recognizer_sensors.testrun.run.subprocess.run", fake)

    coverage = collect_coverage(root, read_scans(root), None, None)

    assert coverage == {"app/m.py": {1: 1}, "web/a.ts": {1: 0}}


def test_a_stale_report_does_not_stand_in_for_a_missing_one(tmp_path, capsys):
    root = repository(tmp_path)
    (root / LCOV).parent.mkdir(parents=True)
    (root / LCOV).write_text("SF:app/m.py\nDA:1,1\nend_of_record\n")
    nothing = script(root, "n.py", NOTHING)

    status, _ = crap(root, tmp_path, {"test_command": [sys.executable, nothing]})

    assert status == 2
    assert "left no coverage report" in sentence(capsys)


def test_killing_the_sensors_group_ends_the_test_command(tmp_path):
    root = repository(tmp_path)
    pid_file = root / "pid.txt"
    sleeper = script(root, "s.py", SLEEP)
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "recognizer_sensors",
            "crap",
            "--repository",
            str(root),
            "--commit",
            "c1",
            "--output",
            str(tmp_path / "o.json"),
            "--settings",
            json.dumps({"test_command": [sys.executable, sleeper, str(pid_file)]}),
        ],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 30

    while not pid_file.exists() and time.monotonic() < deadline:
        time.sleep(0.05)

    pid = int(pid_file.read_text())
    os.killpg(process.pid, signal.SIGKILL)
    process.wait()
    time.sleep(0.3)

    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


PYTHON_PACKAGE = {
    "pkg/__init__.py": "",
    "pkg/calc.py": (
        "def used(a):\n    if a:\n        return 1\n    return 2\n\n\n"
        "def unused(a):\n    if a:\n        return 3\n    return 4\n"
    ),
    "tests/test_calc.py": "from pkg.calc import used\n\n\ndef test_used():\n    assert used(1) == 1\n",
}


def test_the_python_profile_runs_coverage_py_for_real(tmp_path):
    root = repository(tmp_path, PYTHON_PACKAGE)
    bin_dir = os.path.dirname(sys.executable)
    env_path = f"{bin_dir}:{os.environ['PATH']}"
    old = os.environ["PATH"]
    os.environ["PATH"] = env_path

    try:
        status, _ = crap(root, tmp_path, {})
    finally:
        os.environ["PATH"] = old

    overlay = json.loads((root / OVERLAY).read_text())

    assert status == 0
    assert (
        overlay["values"]["coverage"]["pkg/calc.py::used"]
        > overlay["values"]["coverage"]["pkg/calc.py::unused"]
    )
