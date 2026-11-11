import json
import os
import shlex
import signal
import subprocess
import sys
import time

import pytest
from conftest import git_commit, make_repository

from recognizer_sensors.cli import main
from recognizer_sensors.crap.lcov import function_coverage
from recognizer_sensors.scans import Scan, ScanModule, read_scans
from recognizer_sensors.settings import Refusal
from recognizer_sensors.testrun.profiles import (
    PLUGIN_DIRECTORY,
    PROFILES,
    coverage_command,
    mutant_command,
    python_runner,
)
from recognizer_sensors.testrun.run import collect_coverage, exit_reason
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
pathlib.Path(sys.argv[1]).write_text(str(os.getpid()))
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
    interpreter = f"{tmp_path}/.recognizer/cache/python-env/bin/python"
    tail = (
        f"env -u UV_PROJECT_ENVIRONMENT python {PLUGIN_DIRECTORY}/borrowed_python.py {interpreter} -m"
        if runner[0] == "uv"
        else ""
    )
    words = f"{words} {tail}".strip()

    assert f"; {words} coverage run -m pytest; status=$?" in shell
    assert f"; {words} coverage lcov -o {LCOV}; lcov=$?" in shell
    assert shell.endswith("; [ $status -ne 0 ] && exit $status; exit $lcov")
    assert shell.startswith("export COVERAGE_FILE=.recognizer/cache/coverage/python.data")
    assert mutant_command(tmp_path, "python") == [
        *runner,
        *(["env", "-u", "UV_PROJECT_ENVIRONMENT"] if runner[0] == "uv" else []),
        "pytest",
        "-rfE",
    ]


def test_the_python_profile_command_is_spliced_not_joined(tmp_path):
    assert mutant_command(tmp_path, "typescript") == ["npm", "test"]
    assert coverage_command(tmp_path, "python")[:2] == ["sh", "-c"]


def test_a_suite_runs_in_its_login_shell_whatever_the_lockfiles(tmp_path):
    root = repository(tmp_path)
    (root / "uv.lock").write_text("")
    writer = script(root, "w.py", WRITE_LCOV)

    status, _ = crap(root, tmp_path, suites(command(writer, REPORT)))

    assert status == 0
    assert (root / LOG).read_text().split("\n")[0].startswith("== api: ")
    assert not (root / ".recognizer/cache/python-env").exists()


def test_one_scanned_language_runs_exactly_its_coverage_command(tmp_path):
    root = repository(tmp_path)
    (root / "marker.py").write_text("")
    scans = read_scans(root)

    assert [s.language for s in scans] == ["python"]
    assert coverage_command(root, "python")[0] == "sh"


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

    assert collect_coverage(root, [], None, None) == {}


def test_an_xml_coverage_file_is_read_as_jacoco(tmp_path):
    report = (
        '<report><package name="app"><sourcefile name="m.py">'
        '<line nr="1" mi="0" ci="3"/></sourcefile></package></report>'
    )
    root = repository(tmp_path, {"app/m.py": BODY, "cov/jacoco.xml": report})

    assert collect_coverage(root, read_scans(root), None, "cov/jacoco.xml") == {"app/m.py": {1: 3}}


def test_a_jacoco_report_written_by_the_run_is_read(tmp_path):
    fresh = '<report><package name="app"><sourcefile name="m.py"><line nr="1" mi="0" ci="4"/></sourcefile></package></report>'
    root = repository(tmp_path, {"app/m.py": BODY})
    writer = script(
        root,
        "w.py",
        "import pathlib, sys\np = pathlib.Path(sys.argv[1])\np.parent.mkdir(parents=True, exist_ok=True)\n"
        f"p.write_text({fresh!r})\n",
    )
    target = "build/reports/jacoco/test/jacocoTestReport.xml"

    coverage = collect_coverage(root, read_scans(root), [sys.executable, writer, target], target)

    assert coverage == {"app/m.py": {1: 4}}


KOTLIN_REPORT = "build/reports/jacoco/test/jacocoTestReport.xml"

KOTLIN_JACOCO = (
    '<report><package name="app"><sourcefile name="M.kt">'
    '<line nr="1" mi="0" ci="4"/></sourcefile></package></report>'
)


def kotlin_repository(tmp_path):
    root = repository(tmp_path, {"app/M.kt": "class M\n"})
    scans = [Scan("kotlin", (ScanModule("app", ("app/M.kt",)),), False)]

    return root, scans


def test_a_kotlin_report_written_by_the_command_is_read(tmp_path):
    root, scans = kotlin_repository(tmp_path)
    stale = root / KOTLIN_REPORT
    stale.parent.mkdir(parents=True)
    stale.write_text(KOTLIN_JACOCO.replace('ci="4"', 'ci="1"'))
    writer = script(
        root,
        "w.py",
        "import pathlib, sys\np = pathlib.Path(sys.argv[1])\np.parent.mkdir(parents=True, exist_ok=True)\n"
        f"p.write_text({KOTLIN_JACOCO!r})\n",
    )

    coverage = collect_coverage(root, scans, [sys.executable, writer, KOTLIN_REPORT], None)

    assert coverage == {"app/M.kt": {1: 4}}


def test_a_kotlin_report_is_kept_when_no_command_runs(tmp_path):
    root, scans = kotlin_repository(tmp_path)
    report = root / "cov/jacoco.xml"
    report.parent.mkdir(parents=True)
    report.write_text(KOTLIN_JACOCO)

    coverage = collect_coverage(root, scans, None, "cov/jacoco.xml")

    assert report.exists()
    assert coverage == {"app/M.kt": {1: 4}}


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
    }


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
        coverage = collect_coverage(root, read_scans(root), None, None)
    finally:
        os.environ["PATH"] = old

    used = function_coverage(coverage["pkg/calc.py"], 1, 4)
    unused = function_coverage(coverage["pkg/calc.py"], 7, 10)

    assert used > unused


def test_tool_environment_points_uv_at_the_cache_only_when_a_uv_lock_exists(tmp_path):
    from recognizer_sensors.testrun.profiles import tool_environment

    assert tool_environment(tmp_path) is None

    (tmp_path / "uv.lock").write_text("")

    assert tool_environment(tmp_path)["UV_PROJECT_ENVIRONMENT"] == str(
        tmp_path / ".recognizer/cache/python-env"
    )


EMPTY_REPORT = "the test command produced an empty coverage report"

LANGUAGE_FILES = {
    "python": ("app/m.py", "app/m.py"),
    "typescript": ("web/a.ts", "web/a.ts"),
    "rust": ("src/lib.rs", "src/lib.rs"),
    "csharp": ("src/M.cs", "src/M.cs"),
}


def test_an_empty_report_makes_mutation_refuse(tmp_path):
    root = repository(tmp_path)
    empty = script(
        root,
        "e.py",
        "import pathlib, sys\npathlib.Path(sys.argv[1]).parent.mkdir(parents=True, exist_ok=True)\npathlib.Path(sys.argv[1]).write_text('')\n",
    )

    with pytest.raises(Refusal) as refusal:
        collect_coverage(root, read_scans(root), [sys.executable, empty, LCOV], None)

    assert EMPTY_REPORT in refusal.value.diagnosis["line"]
