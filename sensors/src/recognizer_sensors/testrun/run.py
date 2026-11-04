import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap.jacoco import merge_coverage, parse_jacoco
from recognizer_sensors.crap.lcov import Coverage, normalise_path, parse_lcov
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import MeasurementError, SettingsError, relative_path
from recognizer_sensors.testrun.profiles import (
    CONTEXTS_JSON,
    PROFILES,
    by_file_command,
    coverage_command,
)

LOG = Path(".recognizer") / "cache" / "coverage" / "last-run.log"

CACHE_PREFIX = ".recognizer/"

TS_TEST_FILE = re.compile(r"\.(test|spec)\.(ts|tsx|js|jsx|mjs)$")

BY_FILE_DIRECTORY = ".recognizer/cache/coverage/typescript/by-file"

BY_FILE_REPORT = ".recognizer/cache/coverage/typescript/by-file/{number}/lcov.info"

REASON_LIMIT = 200

DECORATION = re.compile(r"^[=!\-\s]*$")

Selection = dict[str, dict[int, frozenset[str]]]


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


COVERLET = "coverlet.collector"

BUILD_PROPERTY_FILES = (
    "Directory.Build.props",
    "Directory.Build.targets",
    "Directory.Packages.props",
)


def names_coverlet(path: Path) -> bool:
    try:
        return COVERLET in path.read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return False


def project_has_coverlet(repository: Path, directory: Path) -> bool:
    if any(names_coverlet(project) for project in directory.glob("*.csproj")):
        return True

    current = directory

    while True:
        if any(names_coverlet(current / name) for name in BUILD_PROPERTY_FILES):
            return True

        if current == repository or repository not in current.parents:
            return False

        current = current.parent


def check_coverlet(repository: Path, scans: list[Scan]) -> None:
    for scan in scans:
        if scan.language != "csharp":
            continue

        for skipped in scan.skip_paths:
            directory = repository / skipped

            if directory.is_dir() and any(directory.glob("*.csproj")):
                if not project_has_coverlet(repository, directory):
                    raise MeasurementError(
                        f"the csharp test project {skipped} does not reference {COVERLET}"
                    )


def plan(
    repository: Path,
    scans: list[Scan],
    test_command: list[str] | None,
    coverage: str | None,
    contexts: bool = False,
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

    check_coverlet(repository, scans)

    steps = [
        Step(
            language if len(languages) > 1 else None,
            coverage_command(repository, language, contexts),
        )
        for language in languages
    ]

    return steps, sources


def sentence(step: Step, what: str) -> str:
    subject = f"the {step.label} test command" if step.label else "the test command"

    return f"{subject} {what}"


def last_meaningful_line(text: str) -> str | None:
    for line in reversed(text.splitlines()):
        if not DECORATION.match(line):
            return " ".join(line.strip("=!- \t").split())

    return None


def failure_reason(step: Step, returncode: int, output: str) -> str:
    return exit_reason(sentence(step, ""), returncode, output)


def exit_reason(subject: str, returncode: int, output: str) -> str:
    reason = f"{subject.strip()} exited {returncode}"
    last = last_meaningful_line(output)

    if last:
        reason = f"{reason}: {last[:REASON_LIMIT]}"

    return f"{reason} (see {LOG.as_posix()})"


def clear_cached_reports(repository: Path, sources: list[Source]) -> None:
    for source in sources:
        if not source.path.startswith(CACHE_PREFIX):
            continue

        if "*" in source.path:
            for match in repository.glob(source.path):
                if match.is_file():
                    match.unlink(missing_ok=True)
        else:
            (repository / source.path).unlink(missing_ok=True)


def run_steps(repository: Path, steps: list[Step], mode: str = "w") -> None:
    if not steps:
        return

    log = repository / LOG
    log.parent.mkdir(parents=True, exist_ok=True)

    with log.open(mode, encoding="utf-8") as stream:
        for step in steps:
            stream.write(f"== {step.label or 'test command'}: {' '.join(step.command)}\n")
            stream.flush()
            offset = stream.tell()

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
                stream.flush()

                with log.open("rb") as written:
                    written.seek(offset)
                    output = written.read().decode("utf-8", errors="replace")

                raise MeasurementError(failure_reason(step, result.returncode, output))


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


def read_contexts(text: str, repository: Path) -> Selection:
    try:
        document = json.loads(text)
    except ValueError:
        return {}

    files = document.get("files") if isinstance(document, dict) else None
    selection: Selection = {}

    if not isinstance(files, dict):
        return selection

    for raw, entry in files.items():
        path = normalise_path(raw, repository)
        contexts = entry.get("contexts") if isinstance(entry, dict) else None

        if path is None or not isinstance(contexts, dict):
            continue

        for number, names in contexts.items():
            tests = usable_contexts(names, repository)

            if tests and number.isdigit():
                selection.setdefault(path, {})[int(number)] = tests

    return selection


def usable_contexts(names: object, repository: Path) -> frozenset[str] | None:
    if not isinstance(names, list) or not names:
        return None

    if not all(isinstance(n, str) and n and (repository / n).is_file() for n in names):
        return None

    return frozenset(names)


def python_selection(repository: Path) -> Selection:
    try:
        text = (repository / CONTEXTS_JSON).read_text(encoding="utf-8")
    except (OSError, ValueError):
        return {}

    return read_contexts(text, repository)


def typescript_test_files(scan: Scan) -> list[str]:
    return [path for module in scan.modules for path in module.files if TS_TEST_FILE.search(path)]


def typescript_selection(repository: Path, scan: Scan, whole: Coverage) -> Selection:
    tests = sorted(set(typescript_test_files(scan)))

    if not tests:
        return {}

    steps = [
        Step(f"typescript {file}", by_file_command(file, number))
        for number, file in enumerate(tests)
    ]

    try:
        run_steps(repository, steps, "a")
    except MeasurementError as error:
        print(
            f"recognizer-sensors: mutation: {error}; running the whole suite for typescript",
            file=sys.stderr,
        )

        return {}

    executed: dict[str, dict[int, set[str]]] = {}

    for number, file in enumerate(tests):
        report = repository / BY_FILE_REPORT.format(number=number)

        try:
            part = parse_lcov(report.read_text(encoding="utf-8"), repository)
        except (OSError, ValueError):
            print(
                f"recognizer-sensors: mutation: no coverage report for {file}; "
                "running the whole suite for typescript",
                file=sys.stderr,
            )

            return {}

        for path, lines in part.items():
            for number_, hits in lines.items():
                if hits > 0:
                    executed.setdefault(path, {}).setdefault(number_, set()).add(file)

    selection: Selection = {}

    for path, lines in whole.items():
        for number_, hits in lines.items():
            files = executed.get(path, {}).get(number_)

            if hits > 0 and files:
                selection.setdefault(path, {})[number_] = frozenset(files)

    return selection


def collect_coverage_with_tests(
    repository: Path, scans: list[Scan], coverage: str | None
) -> tuple[Coverage, Selection]:
    if not scans:
        return {}, {}

    if coverage is not None:
        return collect_coverage(repository, scans, None, coverage), {}

    steps, sources = plan(repository, scans, None, None, contexts=True)
    clear_cached_reports(repository, sources)
    (repository / CONTEXTS_JSON).unlink(missing_ok=True)
    shutil.rmtree(repository / BY_FILE_DIRECTORY, ignore_errors=True)
    run_steps(repository, steps)
    files = [path for scan in scans for module in scan.modules for path in module.files]
    merged: Coverage = {}

    for source in sources:
        part = read_source(repository, source, files)

        if part is None:
            raise MeasurementError(f"the test command left no coverage report: {source.path}")

        merge_coverage(merged, part)

    selection: Selection = {}

    for scan in scans:
        if scan.language == "python":
            selection.update(python_selection(repository))
        elif scan.language == "typescript":
            selection.update(typescript_selection(repository, scan, merged))

    return merged, selection
