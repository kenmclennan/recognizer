import json
import os
import shlex
import signal
import subprocess
import sys
import time

import pytest
from conftest import git_commit, make_repository, wait_for_pid

from recognizer_sensors.cli import main
from recognizer_sensors.mutation.warmup import coverage_run
from recognizer_sensors.scans import Scan, ScanModule, read_scans
from recognizer_sensors.settings import Refusal
from recognizer_sensors.testrun.reports import exit_reason
from recognizer_sensors.testrun.suites import collect_suites, parse_suites

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
temporary = pathlib.Path(f"{sys.argv[1]}.{os.getpid()}.tmp")
temporary.write_text(str(os.getpid()))
os.replace(temporary, sys.argv[1])
time.sleep(60)
"""

BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"


REPORT = "out/lcov.info"

NO_SUITES = (
    "coverage unavailable: no test suites are configured; "
    "add a tests list to .recognizer/config.yaml"
)


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")


def command(*words):
    return shlex.join([sys.executable, *words])


def suite(language="python", run="true", path=REPORT, name="api", directory="."):
    return {
        "name": name,
        "language": language,
        "directory": directory,
        "command": run,
        "coverage": {"path": path, "format": "lcov"},
        **({"runner": "vitest"} if language == "typescript" else {}),
    }


def suites(run, path=REPORT):
    return {"tests": [suite("python", run, path)]}


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


def test_a_suite_runs_in_its_login_shell_whatever_the_lockfiles(tmp_path):
    root = repository(tmp_path)
    (root / "uv.lock").write_text("")
    writer = script(root, "w.py", WRITE_LCOV)

    status, _ = crap(root, tmp_path, suites(command(writer, REPORT)))

    assert status == 0
    assert (root / LOG).read_text().split("\n")[0].startswith("== api: ")
    assert not (root / ".recognizer/cache/python-env").exists()


def test_each_suite_runs_once_and_its_named_report_is_read(tmp_path):
    root = repository(tmp_path)
    writer = script(root, "w.py", WRITE_LCOV)

    coverage, diagnosis = collect_suites(
        root, read_scans(root), parse_suites(suites(command(writer, REPORT))["tests"])
    )

    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}}
    assert diagnosis is None
    assert (root / LOG).read_text().count("== api") == 1


def test_a_suite_runs_then_its_report_is_read(tmp_path):
    root = repository(tmp_path)
    writer = script(root, "w.py", WRITE_LCOV)

    coverage, _ = collect_suites(
        root,
        read_scans(root),
        parse_suites(suites(command(writer, "out/c.info"), path="out/c.info")["tests"]),
    )

    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}}


def test_no_scan_runs_nothing(tmp_path):
    root = tmp_path / "bare"
    root.mkdir()

    assert coverage_run(root, [], [], root / "work") == ({}, {})


KOTLIN_REPORT = "build/reports/jacoco/test/jacocoTestReport.xml"

KOTLIN_JACOCO = (
    '<report><package name="app"><sourcefile name="M.kt">'
    '<line nr="1" mi="0" ci="4"/></sourcefile></package></report>'
)


def kotlin_repository(tmp_path):
    root = repository(tmp_path, {"app/M.kt": "class M\n"})
    scans = [Scan("kotlin", (ScanModule("app", ("app/M.kt",)),), False)]

    return root, scans


def sentence(capsys):
    return capsys.readouterr().err


def diagnosis_of(output):
    return json.loads(output.read_text())["diagnosis"]


def test_a_failing_command_with_no_report_is_complexity_only_with_the_exit_in_the_line(tmp_path):
    root = repository(tmp_path)
    failing = script(root, "f.py", FAIL)

    status, output = crap(root, tmp_path, suites(command(failing, "1")))

    assert status == 0
    assert diagnosis_of(output) == {
        "code": "coverage-unavailable",
        "line": f"coverage unavailable: the api suite exited 1 and left no coverage report at {REPORT}; see {LOG}",
        "suite": "api",
    }

    overlay = json.loads((root / OVERLAY).read_text())

    assert overlay["values"]["coverage"] == {}
    assert overlay["values"]["crap"] == {}
    assert overlay["values"]["complexity"]
    assert "boom" in (root / LOG).read_text()


def test_a_failing_command_keeps_the_report_it_wrote_and_says_the_tests_failed(tmp_path):
    root = repository(tmp_path)
    body = WRITE_LCOV + "\nsys.exit(1)\n"
    writer = script(root, "w.py", body)

    status, output = crap(root, tmp_path, suites(command(writer, REPORT)))

    assert status == 0
    assert diagnosis_of(output) == {
        "code": "tests-failed",
        "line": "the tests failed, so coverage may read low",
        "suite": "api",
    }
    assert json.loads((root / OVERLAY).read_text())["values"]["coverage"]


def test_failing_pytest_lines_give_the_count_and_at_most_five_names(tmp_path):
    root = repository(tmp_path)
    names = [f"tests/test_a.py::test_{i}" for i in range(7)]
    lines = "".join(f"print('FAILED {name} - assert 1 == 2')\n" for name in names)
    writer = script(root, "w.py", WRITE_LCOV + lines + "sys.exit(1)\n")

    status, output = crap(root, tmp_path, suites(command(writer, REPORT)))
    diagnosis = diagnosis_of(output)

    assert status == 0
    assert diagnosis["code"] == "tests-failed"
    assert diagnosis["line"] == "7 tests failed, so coverage may read low"
    assert diagnosis["failing"] == {"count": 7, "names": names[:5]}


def test_the_exit_sentence_keeps_the_summary_line_and_the_log_path():
    output = "collecting ...\n!!!! Interrupted: 2 errors during collection !!!!\n" + "=" * 20 + "\n"

    assert exit_reason("the test command", 2, output) == (
        f"the test command exited 2: Interrupted: 2 errors during collection (see {LOG})"
    )
    assert exit_reason("the test command", 2, "") == f"the test command exited 2 (see {LOG})"
    assert exit_reason("the test command", 2, "x" * 500 + "\n") == (
        f"the test command exited 2: {'x' * 200} (see {LOG})"
    )


def test_a_refusal_or_a_missing_coverage_file_leaves_a_prior_overlay_untouched(tmp_path):
    root = repository(tmp_path)
    writer = script(root, "w.py", WRITE_LCOV)

    assert crap(root, tmp_path, suites(command(writer, REPORT)))[0] == 0

    before = (root / OVERLAY).read_bytes()

    assert crap(root, tmp_path, {})[0] == 2
    assert (root / OVERLAY).read_bytes() == before


def test_a_command_that_does_not_start_is_complexity_only_naming_the_program(tmp_path):
    root = repository(tmp_path)

    status, output = crap(root, tmp_path, suites("/no/such/program"))

    assert status == 0
    assert diagnosis_of(output)["line"] == (
        f"coverage unavailable: the api suite exited 127 and left no coverage report at {REPORT}; see {LOG}"
    )
    assert "/no/such/program" in (root / LOG).read_text()


def test_a_command_that_leaves_no_report_is_complexity_only_naming_the_log(tmp_path):
    root = repository(tmp_path)
    nothing = script(root, "n.py", NOTHING)

    status, output = crap(root, tmp_path, suites(command(nothing)))

    assert status == 0
    assert diagnosis_of(output) == {
        "code": "coverage-unavailable",
        "line": f"coverage unavailable: the api suite left no coverage report at {REPORT}; see {LOG}",
        "suite": "api",
    }


def test_a_missing_coverage_file_with_no_command_has_its_own_sentence(tmp_path, capsys):
    root = repository(tmp_path)

    status, _ = crap(root, tmp_path, {})

    assert status == 2
    assert sentence(capsys).splitlines()[-1] == NO_SUITES


def two_languages(tmp_path):
    root = repository(
        tmp_path,
        {"app/m.py": BODY, "web/a.ts": "export function a(x: number) { return x; }\n"},
    )

    return root


def test_two_languages_run_in_order_and_a_failing_one_does_not_hide_the_other(tmp_path):
    root = two_languages(tmp_path)
    writer = script(
        root, "w.py", WRITE_LCOV.replace("sys.argv[1]", "'out/py.info'") + "\nsys.exit(3)\n"
    )
    failing = script(root, "f.py", FAIL)
    settings = {
        "tests": [
            suite("python", command(writer), path="out/py.info", name="py"),
            suite("typescript", command(failing, "3"), path="out/ts.info", name="ts"),
        ]
    }

    status, output = crap(root, tmp_path, settings)

    assert status == 0
    assert diagnosis_of(output)["code"] == "coverage-unavailable"
    assert "the ts suite exited 3 and left no coverage report" in diagnosis_of(output)["line"]
    assert json.loads((root / OVERLAY).read_text())["values"]["coverage"]

    log = (root / LOG).read_text()

    assert log.index("== py") < log.index("== ts")


def test_two_languages_merge_their_reports_by_path(tmp_path):
    root = two_languages(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    py = script(root, "py.py", WRITE_LCOV)
    ts = script(
        root,
        "ts.py",
        WRITE_LCOV.replace("SF:app/m.py\\nDA:1,1\\nDA:2,1\\nDA:3,0", "SF:web/a.ts\\nDA:1,0"),
    )
    suites = parse_suites(
        [
            suite("python", command(py, "out/py.info"), path="out/py.info", name="py"),
            suite("typescript", command(ts, "out/ts.info"), path="out/ts.info", name="ts"),
        ]
    )

    coverage, _ = coverage_run(root, read_scans(root), suites, work)

    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}, "web/a.ts": {1: 0}}


def test_a_stale_report_does_not_stand_in_for_a_missing_one(tmp_path, capsys):
    root = repository(tmp_path)
    (root / REPORT).parent.mkdir(parents=True)
    (root / REPORT).write_text("SF:app/m.py\nDA:1,1\nend_of_record\n")
    old = time.time() - 3600
    os.utime(root / REPORT, (old, old))
    nothing = script(root, "n.py", NOTHING)

    status, output = crap(root, tmp_path, suites(command(nothing)))

    assert status == 0
    assert "left no coverage report" in diagnosis_of(output)["line"]
    assert json.loads((root / OVERLAY).read_text())["values"]["coverage"] == {}


def test_killing_the_sensors_group_ends_the_suite(tmp_path):
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
            json.dumps(suites(command(sleeper, str(pid_file)))),
        ],
        env={**os.environ, "SHELL": "/bin/sh"},
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    pid = wait_for_pid(pid_file, time.monotonic() + 30)
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


EMPTY_REPORT = "the api suite produced an empty coverage report"

LANGUAGE_FILES = {
    "python": ("app/m.py", "app/m.py"),
    "typescript": ("web/a.ts", "web/a.ts"),
    "rust": ("src/lib.rs", "src/lib.rs"),
    "csharp": ("src/M.cs", "src/M.cs"),
}


def test_an_empty_report_makes_mutation_refuse(tmp_path):
    root = repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    empty = script(
        root,
        "e.py",
        "import pathlib, sys\npathlib.Path(sys.argv[1]).parent.mkdir(parents=True, exist_ok=True)\npathlib.Path(sys.argv[1]).write_text('')\n",
    )
    suites = parse_suites([suite("python", command(empty, REPORT))])

    with pytest.raises(Refusal) as refusal:
        coverage_run(root, read_scans(root), suites, work)

    assert EMPTY_REPORT in refusal.value.diagnosis["line"]


def test_the_warm_up_records_the_seconds_each_suite_took(tmp_path):
    root = repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    py = script(root, "p.py", WRITE_LCOV)
    suites_found = parse_suites([suite("python", command(py, "out/py.info"), path="out/py.info")])
    recorded: dict[str, float] = {}

    coverage_run(root, read_scans(root), suites_found, work, seconds=recorded)

    assert list(recorded) == [suites_found[0].name]
    assert recorded[suites_found[0].name] > 0


def test_a_failing_warm_up_suite_leaves_no_recorded_seconds(tmp_path):
    root = repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    failing = script(root, "f.py", FAIL)
    suites_found = parse_suites([suite("python", command(failing, "1"), path="out/py.info")])
    recorded: dict[str, float] = {}

    with pytest.raises(Refusal):
        coverage_run(root, read_scans(root), suites_found, work, seconds=recorded)

    assert recorded == {}
