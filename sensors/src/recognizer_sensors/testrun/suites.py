import os
import re
import shlex
from dataclasses import dataclass

from recognizer_sensors.settings import SettingsError, relative_path

LANGUAGES = ("python", "typescript", "kotlin", "rust", "csharp")

FORMATS = ("lcov", "jacoco")

RUNNERS = ("vitest", "jest")

KEYS = {"name", "language", "directory", "command", "activate", "env", "coverage", "runner"}

ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

DEFAULT_SHELL = "/bin/zsh"


@dataclass(frozen=True)
class Suite:
    name: str
    language: str
    directory: str
    command: str
    activate: str | None
    env: dict[str, str]
    coverage_path: str
    coverage_format: str
    runner: str | None


def text_of(label: str, value: object) -> str:
    if not isinstance(value, str) or not value:
        raise SettingsError(f"{label} must be a non-empty string")

    return value


def parse_suite(position: int, raw: object) -> Suite:
    if not isinstance(raw, dict):
        raise SettingsError(f"tests[{position}] must be an object")

    name = text_of(f"tests[{position}].name", raw.get("name"))
    unknown = sorted(set(raw) - KEYS)

    if unknown:
        raise SettingsError(f"test suite {name}: unknown key: {', '.join(unknown)}")

    language = raw.get("language")

    if language not in LANGUAGES:
        raise SettingsError(f"test suite {name}: language must be one of {', '.join(LANGUAGES)}")

    try:
        directory = relative_path("directory", raw.get("directory"))
    except SettingsError as error:
        raise SettingsError(f"test suite {name}: {error}") from None

    command = text_of(f"test suite {name}: command", raw.get("command"))
    activate = raw.get("activate")

    if activate is not None:
        activate = text_of(f"test suite {name}: activate", activate)

    env = raw.get("env", {})

    if not isinstance(env, dict) or not all(
        isinstance(k, str) and ENV_NAME.match(k) and isinstance(v, str) for k, v in env.items()
    ):
        raise SettingsError(f"test suite {name}: env must map variable names to string values")

    coverage = raw.get("coverage")

    if not isinstance(coverage, dict) or set(coverage) != {"path", "format"}:
        raise SettingsError(f"test suite {name}: coverage must hold exactly a path and a format")

    try:
        path = relative_path("coverage.path", coverage["path"])
    except SettingsError as error:
        raise SettingsError(f"test suite {name}: {error}") from None

    if coverage["format"] not in FORMATS:
        raise SettingsError(f"test suite {name}: coverage.format must be lcov or jacoco")

    runner = raw.get("runner")

    if language == "typescript" and runner not in RUNNERS:
        raise SettingsError(f"test suite {name}: a typescript suite needs a runner, vitest or jest")

    if language != "typescript" and runner is not None:
        raise SettingsError(f"test suite {name}: runner applies to typescript suites only")

    return Suite(
        name,
        language,
        directory,
        command,
        activate,
        dict(env),
        path,
        coverage["format"],
        runner,
    )


def parse_suites(raw: object) -> tuple[Suite, ...]:
    if not isinstance(raw, list) or not raw:
        raise SettingsError("tests must be a non-empty array")

    suites = tuple(parse_suite(position, item) for position, item in enumerate(raw))
    seen: set[str] = set()

    for suite in suites:
        if suite.name in seen:
            raise SettingsError(f"test suite {suite.name}: the name is used twice")

        seen.add(suite.name)

    return suites


def shell_script(suite: Suite) -> str:
    steps = [f"cd {shlex.quote(suite.directory)}"]

    if suite.activate:
        steps.append(suite.activate)

    steps.append(suite.command)

    return " && ".join(steps)


def login_shell() -> str:
    return os.environ.get("SHELL") or DEFAULT_SHELL
