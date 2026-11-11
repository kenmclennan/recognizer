import pytest

from recognizer_sensors.settings import SettingsError
from recognizer_sensors.testrun.suites import (
    Suite,
    login_shell,
    parse_suites,
    shell_script,
)


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")


def raw(language="python", **overrides):
    suite = {
        "name": "api",
        "language": language,
        "directory": ".",
        "command": "true",
        "coverage": {"path": "out/lcov.info", "format": "lcov"},
    }

    if language == "typescript":
        suite["runner"] = "vitest"

    return {**suite, **overrides}


@pytest.mark.parametrize("language", ["python", "typescript", "kotlin", "rust", "csharp"])
def test_a_valid_suite_parses_for_every_language(language):
    (suite,) = parse_suites([raw(language, activate="true", env={"A": "1"})])

    assert suite == Suite(
        "api",
        language,
        ".",
        "true",
        "true",
        {"A": "1"},
        "out/lcov.info",
        "lcov",
        "vitest" if language == "typescript" else None,
    )


@pytest.mark.parametrize(
    ("item", "needle"),
    [
        (raw("typescript", runner=None), "needs a runner"),
        (raw("python", runner="jest"), "typescript suites only"),
        (raw(coverage={"path": "x", "format": "cobertura"}), "lcov or jacoco"),
        (raw(directory="/abs"), "relative path"),
        (raw(directory="a/../../b"), "relative path"),
        (raw(language="ruby"), "language must be one of"),
        (raw(extra=1), "unknown key"),
        (raw(env={"bad name": "x"}), "env must map"),
        (raw(coverage={"path": "x"}), "coverage must hold"),
    ],
)
def test_a_bad_suite_is_refused_naming_it(item, needle):
    with pytest.raises(SettingsError) as error:
        parse_suites([item])

    assert "api" in str(error.value)
    assert needle in str(error.value)


def test_a_duplicate_suite_name_is_refused_naming_it():
    with pytest.raises(SettingsError, match="api: the name is used twice"):
        parse_suites([raw(), raw()])


def test_an_empty_list_is_refused():
    with pytest.raises(SettingsError):
        parse_suites([])


def suite_of(**overrides):
    return parse_suites([raw(**overrides)])[0]


def test_the_script_is_directory_then_activate_then_command():
    assert shell_script(suite_of(directory="svc", activate="nvm use", command="npm test")) == (
        "cd svc && nvm use && npm test"
    )


def test_the_script_omits_an_absent_activate():
    assert shell_script(suite_of(directory="svc", command="make test")) == "cd svc && make test"


def test_a_directory_with_a_space_and_a_quote_is_quoted():
    script = shell_script(suite_of(directory="my dir/it's"))

    assert script == "cd 'my dir/it'\"'\"'s' && true"


def test_the_root_directory_becomes_cd_dot():
    assert shell_script(suite_of(directory=".")).startswith("cd . && ")


def test_the_shell_falls_back_to_zsh_when_unset(monkeypatch):
    monkeypatch.delenv("SHELL")

    assert login_shell() == "/bin/zsh"
