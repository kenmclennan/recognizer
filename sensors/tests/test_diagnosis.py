import json
import subprocess
import sys

from conftest import FINDINGS_SCHEMA, git_commit, make_repository, mutate_repository
from jsonschema import Draft202012Validator
from test_mutation import COVERAGE, run_mutate

from recognizer_sensors.cli import main
from recognizer_sensors.settings import MeasurementError, Refusal, diagnose
from recognizer_sensors.testrun.failures import (
    crap_tests_failed,
    csharp_names,
    kotlin_names,
    log_names,
    mutation_tests_failed,
    suite_failed,
)
from recognizer_sensors.testrun.profiles import PROFILES, PYTHON_COVERAGE, PYTHON_COVERAGE_CONTEXTS

BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"

LCOV = ".recognizer/cache/coverage/python.lcov"

COVERAGE_STUB = """
import pathlib, sys
args = sys.argv[1:]
if args[:2] == ["coverage", "run"]:
    sys.exit(int(pathlib.Path(__file__).with_name("run.status").read_text()))
if args[:2] == ["coverage", "lcov"]:
    pathlib.Path(args[3]).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(args[3]).write_text("SF:app/m.py\\nDA:1,1\\nend_of_record\\n")
    sys.exit(int(pathlib.Path(__file__).with_name("lcov.status").read_text()))
"""


def shell_run(tmp_path, command, run_status, lcov_status=0):
    (tmp_path / "stub.py").write_text(COVERAGE_STUB)
    (tmp_path / "run.status").write_text(str(run_status))
    (tmp_path / "lcov.status").write_text(str(lcov_status))
    work = tmp_path / "work"
    work.mkdir(exist_ok=True)
    script = command.replace("{runner}", f"{sys.executable} {tmp_path / 'stub.py'}")
    result = subprocess.run(["sh", "-c", script], cwd=work, check=False)

    return result.returncode, work


def test_the_python_command_writes_its_report_after_a_red_suite_and_keeps_the_status(tmp_path):
    status, work = shell_run(tmp_path, PYTHON_COVERAGE, 1)

    assert status == 1
    assert (work / LCOV).is_file()


def test_the_python_command_exits_zero_on_a_green_suite_and_reports_a_report_failure(tmp_path):
    assert shell_run(tmp_path, PYTHON_COVERAGE, 0)[0] == 0
    assert shell_run(tmp_path, PYTHON_COVERAGE, 0, 3)[0] == 3


def test_the_contexts_command_writes_the_report_after_a_red_suite_and_writes_no_contexts_json(
    tmp_path,
):
    command = PYTHON_COVERAGE_CONTEXTS.format(plugin="/plugin")
    status, work = shell_run(tmp_path, command, 1)

    assert status == 1
    assert (work / LCOV).is_file()
    assert not (work / ".recognizer/cache/coverage/python.contexts.json").exists()


def test_the_rust_coverage_command_ignores_a_red_suite():
    command = PROFILES["rust"]["coverage_command"]

    assert command[:3] == ["cargo", "llvm-cov", "--lcov"]
    assert "--ignore-run-fail" in command


def test_a_log_with_three_failures_yields_three_names():
    log = "FAILED t/a.py::one - assert 1\nFAILED t/a.py::two[x y] - boom\nERROR t/b.py\n"

    assert log_names("python", log) == ["t/a.py::one", "t/a.py::two[x y]", "t/b.py"]


def test_a_rust_log_names_each_failed_test_and_counts_as_failed_on_exit_zero():
    log = "test a::ok ... ok\ntest a::bad ... FAILED\ntest result: FAILED. 1 passed; 1 failed\n"

    assert log_names("rust", log) == ["a::bad"]
    assert suite_failed("rust", 0, log)
    assert not suite_failed("python", 0, log)


def test_failing_names_are_capped_at_five_and_counted_in_full():
    names = [f"t{i}" for i in range(7)]

    assert crap_tests_failed(names)["failing"] == {"count": 7, "names": names[:5]}
    assert crap_tests_failed(names)["line"] == "7 tests failed, so coverage may read low"
    assert mutation_tests_failed(names)["line"] == (
        "the test suite fails before any mutation: t0 and 6 more"
    )


def test_a_log_with_nothing_parseable_has_no_failing_field():
    diagnosis = crap_tests_failed(log_names("typescript", "not ok 1\n"))

    assert "failing" not in diagnosis
    assert diagnosis["line"] == "the tests failed, so coverage may read low"
    assert mutation_tests_failed([])["line"] == "the test suite fails before any mutation"


def test_the_kotlin_reader_lists_failed_cases(tmp_path):
    results = tmp_path / "app/build/test-results/test"
    results.mkdir(parents=True)
    (results / "TEST-a.B.xml").write_text(
        '<testsuite><testcase classname="a.B" name="ok"/>'
        '<testcase classname="a.B" name="bad"><failure message="x"/></testcase></testsuite>'
    )

    assert kotlin_names(tmp_path) == ["a.B.bad"]


def test_the_csharp_reader_lists_failed_results(tmp_path):
    (tmp_path / "results_1.trx").write_text(
        '<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"><Results>'
        '<UnitTestResult testName="N.T.Ok" outcome="Passed"/>'
        '<UnitTestResult testName="N.T.Bad" outcome="Failed"/></Results></TestRun>'
    )

    assert csharp_names(tmp_path) == ["N.T.Bad"]


def test_a_refusal_is_a_measurement_error_carrying_its_diagnosis():
    refusal = Refusal(diagnose("tool-missing", "x is not installed", "brew install x"))

    assert isinstance(refusal, MeasurementError)
    assert str(refusal) == "x is not installed"
    assert refusal.diagnosis == {
        "code": "tool-missing",
        "line": "x is not installed",
        "fix": "brew install x",
    }


def crap_document(tmp_path, settings):
    root = make_repository(tmp_path / "r", {"app/m.py": BODY})
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
            json.dumps(settings),
        ]
    )

    return status, json.loads(output.read_text())


def test_a_complexity_only_document_still_warns_and_validates(tmp_path):
    nothing = tmp_path / "n.py"
    nothing.write_text("print('no report')")

    status, document = crap_document(
        tmp_path, {"test_command": [sys.executable, str(nothing)], "threshold": 2}
    )

    assert status == 0
    assert document["diagnosis"]["code"] == "coverage-unavailable"
    assert [f["summary"] for f in document["findings"]] == [
        "f in app/m.py has complexity 2 and unknown coverage, CRAP at least 2"
    ]
    assert "coverage" not in document["findings"][0]["evidence"]["measures"]

    schema = json.loads(FINDINGS_SCHEMA.read_text())

    Draft202012Validator(schema).validate(document)


def test_mutation_over_a_red_suite_refuses_before_any_work_folder(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    failing = tmp_path / "f.py"
    failing.write_text("import sys; print('FAILED t/a.py::bad - x'); sys.exit(1)")
    output = tmp_path / "overlay.json"
    settings = json.dumps({"test_command": [sys.executable, str(failing)], "coverage": COVERAGE})

    status = run_mutate(root, output, settings)
    lines = capsys.readouterr().err.splitlines()

    assert status == 2
    assert json.loads(lines[0].removeprefix("recognizer-reason "))["code"] == "tests-failed"
    assert lines[-1] == "the test suite fails before any mutation: t/a.py::bad"
    assert not output.exists()
    assert not (root / ".recognizer/cache/mutation/work").exists()
