import subprocess
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap.jacoco import merge_coverage, parse_jacoco
from recognizer_sensors.crap.lcov import Coverage, parse_lcov
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import MeasurementError, SettingsError, relative_path
from recognizer_sensors.testrun.profiles import PROFILES, coverage_command

LOG = Path(".recognizer") / "cache" / "coverage" / "last-run.log"

CACHE_PREFIX = ".recognizer/"


@dataclass(frozen=True)
class Step:
    label: str | None
    command: list[str]


@dataclass(frozen=True)
class Source:
    path: str
    format: str


def parse_test_command(raw: dict) -> list[str] | None:
    if "test_command" not in raw:
        return None

    command = raw["test_command"]

    if (
        not isinstance(command, list)
        or not command
        or not all(isinstance(item, str) and item for item in command)
    ):
        raise SettingsError("test_command must be a non-empty array of non-empty strings")

    return list(command)


def parse_coverage(raw: dict) -> str | None:
    return relative_path("coverage", raw["coverage"]) if "coverage" in raw else None


def format_of(path: str) -> str:
    return "jacoco" if path.endswith(".xml") else "lcov"


def plan(
    repository: Path, scans: list[Scan], test_command: list[str] | None, coverage: str | None
) -> tuple[list[Step], list[Source]]:
    languages = [scan.language for scan in scans]

    if coverage is not None:
        sources = [Source(coverage, format_of(coverage))]
    else:
        sources = [Source(PROFILES[name]["report"], PROFILES[name]["format"]) for name in languages]

    if test_command is not None:
        return [Step(None, test_command)], sources

    if coverage is not None:
        return [], sources

    steps = [
        Step(language if len(languages) > 1 else None, coverage_command(repository, language))
        for language in languages
    ]

    return steps, sources


def sentence(step: Step, what: str) -> str:
    subject = f"the {step.label} test command" if step.label else "the test command"

    return f"{subject} {what}"


def clear_cached_reports(repository: Path, sources: list[Source]) -> None:
    for source in sources:
        if source.path.startswith(CACHE_PREFIX) and "*" not in source.path:
            (repository / source.path).unlink(missing_ok=True)


def run_steps(repository: Path, steps: list[Step]) -> None:
    if not steps:
        return

    log = repository / LOG
    log.parent.mkdir(parents=True, exist_ok=True)

    with log.open("w", encoding="utf-8") as stream:
        for step in steps:
            stream.write(f"== {step.label or 'test command'}: {' '.join(step.command)}\n")
            stream.flush()

            try:
                result = subprocess.run(
                    step.command,
                    cwd=repository,
                    stdin=subprocess.DEVNULL,
                    stdout=stream,
                    stderr=subprocess.STDOUT,
                    check=False,
                )
            except OSError:
                raise MeasurementError(
                    sentence(step, f"did not start: {step.command[0]}")
                ) from None

            if result.returncode != 0:
                raise MeasurementError(sentence(step, f"exited {result.returncode}"))


def read_source(repository: Path, source: Source, files: list[str]) -> Coverage | None:
    matches = sorted(p for p in repository.glob(source.path) if p.is_file())

    if not matches:
        return None

    merged: Coverage = {}

    for match in matches:
        try:
            text = match.read_text(encoding="utf-8")
        except (OSError, ValueError):
            continue

        part = (
            parse_jacoco(text, files) if source.format == "jacoco" else parse_lcov(text, repository)
        )

        if part is not None:
            merge_coverage(merged, part)

    return merged


def collect_coverage(
    repository: Path,
    scans: list[Scan],
    test_command: list[str] | None,
    coverage: str | None,
) -> Coverage:
    if not scans:
        return {}

    steps, sources = plan(repository, scans, test_command, coverage)
    clear_cached_reports(repository, sources)
    run_steps(repository, steps)
    files = [path for scan in scans for module in scan.modules for path in module.files]
    merged: Coverage = {}

    for source in sources:
        part = read_source(repository, source, files)

        if part is None:
            if steps:
                raise MeasurementError(f"the test command left no coverage report: {source.path}")

            raise MeasurementError(f"the coverage file is missing: {source.path}")

        merge_coverage(merged, part)

    return merged
