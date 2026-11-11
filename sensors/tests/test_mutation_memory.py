from recognizer_sensors.mutation.runner import run_test_command
from recognizer_sensors.testrun.suites import Suite

BINDING = (
    "-Dorg.gradle.daemon=false -Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process"
)


def kotlin_suite(env=None):
    return Suite("k", "kotlin", ".", "true", None, env or {}, "c", "lcov", None)


def test_a_kotlin_suite_gets_the_gradle_options(tmp_path):
    result = run_test_command("printenv GRADLE_OPTS", tmp_path, 30, kotlin_suite())

    assert BINDING in result.output


def test_an_existing_gradle_options_value_comes_first(tmp_path):
    result = run_test_command(
        "echo OPTS=$GRADLE_OPTS", tmp_path, 30, kotlin_suite({"GRADLE_OPTS": "-Xmx1g"})
    )
    line = next(row for row in result.output.splitlines() if row.startswith("OPTS="))

    assert line.startswith("OPTS=-Xmx1g")
    assert line.endswith(BINDING)


def test_another_language_gets_no_gradle_options(tmp_path, monkeypatch):
    monkeypatch.delenv("GRADLE_OPTS", raising=False)
    suite = Suite("p", "python", ".", "true", None, {}, "c", "lcov", None)

    result = run_test_command("echo OPTS=$GRADLE_OPTS", tmp_path, 30, suite)

    assert "OPTS=" in result.output.splitlines()
