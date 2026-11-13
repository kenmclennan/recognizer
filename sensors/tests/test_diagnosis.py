import json
import shlex
import sys

import pytest
from conftest import FINDINGS_SCHEMA, git_commit, make_repository, mutate_repository, python_suite
from jsonschema import Draft202012Validator
from test_mutation import run_mutate

from recognizer_sensors.cli import main
from recognizer_sensors.mutation.warmup import CARRY_HINT
from recognizer_sensors.settings import MeasurementError, Refusal, diagnose
from recognizer_sensors.testrun.failures import (
    crap_tests_failed,
    csharp_names,
    kotlin_names,
    log_names,
    mutation_tests_failed,
    suite_failed,
)

BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"

LCOV = ".recognizer/cache/coverage/python.lcov"


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


def test_a_complexity_only_document_still_warns_and_validates(tmp_path, monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")
    nothing = tmp_path / "n.py"
    nothing.write_text("print('no report')")
    suite = {
        "name": "api",
        "language": "python",
        "directory": ".",
        "command": f"{shlex.quote(sys.executable)} {shlex.quote(str(nothing))}",
        "coverage": {"path": "coverage/lcov.info", "format": "lcov"},
    }

    status, document = crap_document(tmp_path, {"tests": [suite], "threshold": 1})

    assert status == 0
    assert document["diagnosis"]["code"] == "coverage-unavailable"
    assert [f["summary"] for f in document["findings"]] == [
        "f in app/m.py has complexity 2 and unknown coverage, CRAP at least 2"
    ]
    assert "coverage" not in document["findings"][0]["evidence"]["measures"]

    schema = json.loads(FINDINGS_SCHEMA.read_text())

    Draft202012Validator(schema).validate(document)


@pytest.mark.usefixtures("unprimed")
def test_mutation_over_a_red_suite_refuses_and_leaves_no_work_folder(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    failing = tmp_path / "f.py"
    failing.write_text("import sys; print('FAILED t/a.py::bad - x'); sys.exit(1)")
    output = tmp_path / "overlay.json"
    settings = json.dumps({"tests": [python_suite(str(failing))]})

    status = run_mutate(root, output, settings)
    lines = [line for line in capsys.readouterr().err.splitlines() if line != CARRY_HINT]

    assert status == 2
    assert json.loads(lines[0].removeprefix("recognizer-reason "))["code"] == "tests-failed"
    assert lines[-1] == "the test suite fails before any mutation: t/a.py::bad"
    assert not output.exists()
    assert not (root / ".recognizer/cache/mutation/work").exists()
