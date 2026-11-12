import os
import re
import shlex
import shutil
import subprocess
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap.jacoco import merge_coverage
from recognizer_sensors.crap.lcov import Coverage
from recognizer_sensors.progress import report
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import Refusal, SettingsError, diagnose, relative_path
from recognizer_sensors.testrun.failures import crap_tests_failed, failing_names, suite_failed
from recognizer_sensors.testrun.reports import (
    LOG,
    Source,
    covers_nothing,
    read_source,
)

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


def shell_script(suite: Suite, command: str | None = None) -> str:
    steps = [f"cd {shlex.quote(suite.directory)}"]

    if suite.activate:
        steps.append(suite.activate)

    steps.append(suite.command if command is None else command)

    return " && ".join(steps)


def directory_of(suite: Suite) -> str:
    return "" if suite.directory in ("", ".") else suite.directory.strip("/")


def selected(suites: Iterable[Suite], names: Iterable[str] | None) -> tuple[Suite, ...]:
    configured = tuple(suites)

    if names is None:
        return configured

    wanted = list(names)

    if not wanted:
        raise SettingsError("suites must name at least one suite")

    known = {suite.name for suite in configured}
    unknown = sorted({name for name in wanted if name not in known})

    if unknown:
        raise SettingsError(f"unknown test suite: {', '.join(unknown)}")

    chosen = set(wanted)

    return tuple(suite for suite in configured if suite.name in chosen)


def within(path: str, directory: str) -> bool:
    return directory == "" or path == directory or path.startswith(f"{directory}/")


def owner_of(suites: Iterable[Suite], file: str) -> Suite | None:
    owners = [suite for suite in suites if within(file, directory_of(suite))]

    return max(owners, key=lambda suite: len(directory_of(suite)), default=None)


def login_shell() -> str:
    return os.environ.get("SHELL") or DEFAULT_SHELL


def report_pattern(suite: Suite) -> str:
    if suite.directory in ("", "."):
        return suite.coverage_path

    return f"{suite.directory.rstrip('/')}/{suite.coverage_path}"


def source_of(suite: Suite) -> Source:
    return Source(report_pattern(suite), suite.coverage_format, directory_of(suite), suite.name)


COVERAGE_CACHE = ".recognizer/cache/coverage"

PYCACHE_CACHE = ".recognizer/cache/pycache"

SLUG_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


def suite_folder(suite: Suite) -> str:
    slug = SLUG_UNSAFE.sub("-", suite.name)

    if slug.startswith("."):
        slug = f"-{slug[1:]}"

    return f"{COVERAGE_CACHE}/{slug}"


def suite_environment(repository: Path, suite: Suite) -> dict[str, str]:
    if suite.language != "python":
        return {}

    root = repository.resolve()
    wanted = {
        "COVERAGE_FILE": str(root / suite_folder(suite) / "data"),
        "PYTHONPYCACHEPREFIX": str(root / PYCACHE_CACHE),
    }

    return {name: value for name, value in wanted.items() if name not in suite.env}


def prepare_suite_folder(root: Path, suite: Suite) -> None:
    folder = root / suite_folder(suite)

    if folder.exists():
        shutil.rmtree(folder)

    folder.mkdir(parents=True)


def run_suite(repository: Path, suite: Suite, stream) -> tuple[int, str]:
    prepare_suite_folder(repository, suite)
    stream.write(f"== {suite.name}: {suite.command}\n")
    stream.flush()
    offset = stream.tell()
    shell = login_shell()

    try:
        result = subprocess.run(
            [shell, "-ilc", shell_script(suite)],
            cwd=repository,
            env={**os.environ, **suite_environment(repository, suite), **suite.env},
            stdin=subprocess.DEVNULL,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=False,
        )
    except OSError:
        raise Refusal(diagnose("tool-missing", f"{shell} could not be started")) from None

    stream.flush()

    with (repository / LOG).open("rb") as written:
        written.seek(offset)
        output = written.read().decode("utf-8", errors="replace")

    return result.returncode, output


def unavailable(cause: str, suite: str | None = None) -> dict:
    return diagnose(
        "coverage-unavailable",
        f"coverage unavailable: {cause}; see {LOG.as_posix()}",
        suite=suite,
    )


def collect_suites(
    repository: Path,
    scans: list[Scan],
    suites: tuple[Suite, ...],
    names: Iterable[str] | None = None,
    stored: Mapping[str, Coverage] | None = None,
    results: dict[str, dict] | None = None,
) -> tuple[Coverage, dict | None]:
    if not scans:
        return {}, None

    scanned = [scan.language for scan in scans]
    files = [path for scan in scans for module in scan.modules for path in module.files]
    uncovered = [
        language for language in scanned if not any(s.language == language for s in suites)
    ]
    chosen = selected(suites, names)
    runnable = [suite for suite in chosen if suite.language in scanned]
    merged: Coverage = {}
    diagnosis: dict | None = None
    log = repository / LOG
    log.parent.mkdir(parents=True, exist_ok=True)

    for suite in suites:
        if suite not in chosen and stored and suite.name in stored:
            merge_coverage(merged, stored[suite.name])

    with log.open("w", encoding="utf-8") as stream:
        for suite in runnable:
            report("coverage", suite=suite.name)
            started = time.time()
            returncode, output = run_suite(repository, suite, stream)
            source = source_of(suite)
            part = read_source(repository, source, files, started)
            failed = suite_failed(suite.language, returncode, output)
            where = report_pattern(suite)
            outcome: dict = {"status": "ok", "reason": None, "part": part}

            if results is not None:
                results[suite.name] = outcome

            if part is None:
                cause = f"the {suite.name} suite left no coverage report at {where}"

                if failed:
                    cause = (
                        f"the {suite.name} suite exited {returncode} "
                        f"and left no coverage report at {where}"
                    )

                diagnosis = unavailable(cause, suite.name)
                outcome.update(status="failed", reason=diagnosis["line"])

                continue

            merge_coverage(merged, part)

            if covers_nothing(part, source, suite.language, scans):
                diagnosis = unavailable(
                    f"the {suite.name} suite produced an empty coverage report", suite.name
                )
                outcome.update(status="failed", reason=diagnosis["line"])

            if failed:
                names_failing = (
                    []
                    if suite.language == "csharp"
                    else failing_names(repository, suite.language, output, suite.directory)
                )
                diagnosis = crap_tests_failed(names_failing, suite.name)
                outcome.update(status="failed", reason=diagnosis["line"])

    if uncovered:
        diagnosis = diagnose(
            "coverage-unavailable",
            f"coverage unavailable: no test suite is configured for {', '.join(uncovered)}",
        )

    return merged, diagnosis
