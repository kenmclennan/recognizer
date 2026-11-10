import json
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ElementTree
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap.jacoco import merge_coverage, parse_jacoco
from recognizer_sensors.crap.lcov import Coverage, parse_lcov
from recognizer_sensors.hashes import listed_files
from recognizer_sensors.mutation.test_files import is_script_test_file, is_test_file
from recognizer_sensors.parsing import parse
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import (
    MeasurementError,
    Refusal,
    SettingsError,
    diagnose,
    relative_path,
)
from recognizer_sensors.testrun.contexts import ContextSelection, PythonContexts
from recognizer_sensors.testrun.failures import (
    crap_tests_failed,
    failing_names,
    known_cause,
    mutation_tests_failed,
    named,
    suite_failed,
)
from recognizer_sensors.testrun.probes import probe
from recognizer_sensors.testrun.profiles import (
    CSHARP_CLASSES,
    KOTLIN_CLASSES,
    LEGACY_CONTEXTS_PATH,
    PROFILES,
    PYTHON_BORROWED,
    PYTHON_DATA,
    RUST_UNITS,
    by_file_command,
    coverage_command,
    csharp_by_file_command,
    kotlin_by_file_command,
    rust_by_target_command,
    tool_environment,
)
from recognizer_sensors.testrun.selection import Selection, SelectionBuilder

LOG = Path(".recognizer") / "cache" / "coverage" / "last-run.log"

CACHE_PREFIX = ".recognizer/"

TYPESCRIPT_RAW_DIRECTORY = ".recognizer/cache/coverage/typescript/tmp"

BY_FILE_DIRECTORY = ".recognizer/cache/coverage/typescript/by-file"

BY_FILE_REPORT = ".recognizer/cache/coverage/typescript/by-file/{number}/lcov.info"

KOTLIN_BY_FILE_DIRECTORY = ".recognizer/cache/coverage/kotlin/by-file"

KOTLIN_REPORT_GLOB = "**/build/reports/jacoco/test/jacocoTestReport.xml"

KOTLIN_RESULTS_GLOB = "**/build/test-results/test/TEST-*.xml"

KOTLIN_PACKAGE = re.compile(r"^package\s+([\w.`]+)", re.MULTILINE)

KOTLIN_DECLARATION = re.compile(
    r"^(?:@\w+(?:\([^)]*\))?\s+)*"
    r"(?:(?:public|internal|private|open|abstract|final|data|sealed|inner|enum|annotation|value)\s+)*"
    r"(?:class|object)\s+(\w+)",
    re.MULTILINE,
)

CSHARP_DIRECTORY = ".recognizer/cache/coverage/csharp"

CSHARP_BY_FILE_DIRECTORY = ".recognizer/cache/coverage/csharp/by-file"

CSHARP_CLASS_NAME = re.compile(r"^[A-Za-z0-9_.+]+$")

CSHARP_TYPES = ("class_declaration", "record_declaration", "struct_declaration")

RUST_BY_TARGET_DIRECTORY = ".recognizer/cache/coverage/rust/by-target"

RUST_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]*$")

RUST_LIB_KINDS = {"lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"}

REASON_LIMIT = 200

DECORATION = re.compile(r"^[=!\-\s]*$")


@dataclass(frozen=True)
class Step:
    label: str | None
    command: list[str]
    language: str | None = None


@dataclass(frozen=True)
class StepResult:
    step: Step
    returncode: int
    output: str


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

    found = probe(repository, scans, {})

    if found.diagnosis is not None:
        raise Refusal(found.diagnosis)

    PYTHON_BORROWED[:] = found.borrowed

    steps = [
        Step(
            language if len(languages) > 1 else None,
            coverage_command(repository, language, contexts),
            language,
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


def clear_stale_kotlin_reports(
    repository: Path, scans: list[Scan], sources: list[Source], steps: list[Step]
) -> None:
    if not steps or not any(scan.language == "kotlin" for scan in scans):
        return

    for source in sources:
        if source.format != "jacoco" or source.path.startswith(CACHE_PREFIX):
            continue

        for match in repository.glob(source.path):
            if match.is_file():
                match.unlink(missing_ok=True)


def not_installed(program: str) -> Refusal:
    return Refusal(diagnose("tool-missing", f"{program} is not installed"))


def run_steps(
    repository: Path, steps: list[Step], mode: str = "w", strict: bool = False
) -> list[StepResult]:
    if not steps:
        return []

    log = repository / LOG
    log.parent.mkdir(parents=True, exist_ok=True)
    results: list[StepResult] = []

    with log.open(mode, encoding="utf-8") as stream:
        for step in steps:
            stream.write(f"== {step.label or 'test command'}: {' '.join(step.command)}\n")
            stream.flush()
            offset = stream.tell()

            try:
                result = subprocess.run(
                    step.command,
                    cwd=repository,
                    env=tool_environment(repository),
                    stdin=subprocess.DEVNULL,
                    stdout=stream,
                    stderr=subprocess.STDOUT,
                    check=False,
                )
            except OSError:
                raise not_installed(step.command[0]) from None

            stream.flush()

            with log.open("rb") as written:
                written.seek(offset)
                output = written.read().decode("utf-8", errors="replace")

            if strict and result.returncode != 0:
                raise MeasurementError(failure_reason(step, result.returncode, output))

            results.append(StepResult(step, result.returncode, output))

    return results


def settle(
    repository: Path,
    results: list[StepResult],
    merged: Coverage,
    missing: list[Source],
    diagnoses: list[dict] | None,
) -> None:
    failed = [r for r in results if suite_failed(r.step.language, r.returncode, r.output)]
    names = [n for r in failed for n in failing_names(repository, r.step.language, r.output)]

    if failed and (names or not missing):
        if diagnoses is None:
            raise Refusal(mutation_tests_failed(names))

        diagnoses.append(crap_tests_failed(names))

    if not missing:
        return

    known = known_cause([r.output for r in failed])

    if known is not None:
        cause, sentence, fix = known
        diagnosis = diagnose(
            "coverage-unavailable", f"coverage unavailable: {cause}; {sentence}", fix=fix
        )

        if diagnoses is None:
            raise Refusal(diagnosis)

        diagnoses.append(diagnosis)

        return

    cause = "the test command left no coverage report"

    if names:
        cause = f"{cause} after {named(names)} failed"
    elif failed:
        cause = f"the test command exited {failed[0].returncode} and left no coverage report"

    diagnosis = diagnose(
        "coverage-unavailable",
        f"coverage unavailable: {cause}; see {LOG.as_posix()}",
    )

    if diagnoses is None:
        raise Refusal(diagnosis)

    diagnoses.append(diagnosis)


def read_reports(
    repository: Path,
    sources: list[Source],
    scans: list[Scan],
    steps: list[Step],
    results: list[StepResult],
    diagnoses: list[dict] | None,
    since: float | None = None,
) -> Coverage:
    files = [path for scan in scans for module in scan.modules for path in module.files]
    merged: Coverage = {}
    missing: list[Source] = []

    for source in sources:
        part = read_source(repository, source, files, since)

        if part is None:
            missing.append(source)
        else:
            merge_coverage(merged, part)

    if not steps:
        if missing:
            raise MeasurementError(f"the coverage file is missing: {missing[0].path}")

        return merged

    settle(repository, results, merged, missing, diagnoses)

    return merged


def fresh_reports(repository: Path, pattern: str, since: float | None) -> list[Path]:
    matches = sorted(p for p in repository.glob(pattern) if p.is_file())

    if since is None or pattern.startswith(CACHE_PREFIX):
        return matches

    return [p for p in matches if p.stat().st_mtime >= since]


def read_source(
    repository: Path, source: Source, files: list[str], since: float | None = None
) -> Coverage | None:
    matches = fresh_reports(repository, source.path, since)

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
    diagnoses: list[dict] | None = None,
) -> Coverage:
    if not scans:
        return {}

    try:
        steps, sources = plan(repository, scans, test_command, coverage)
        clear_cached_reports(repository, sources)
        clear_stale_kotlin_reports(repository, scans, sources, steps)
        started = time.time() if steps else None
        results = run_steps(repository, steps)
    except Refusal as refusal:
        if diagnoses is None:
            raise

        original = refusal.diagnosis
        diagnoses.append(
            diagnose(
                "coverage-unavailable",
                f"coverage unavailable: {original['line']}",
                fix=original.get("fix"),
            )
        )

        return {}

    try:
        return read_reports(repository, sources, scans, steps, results, diagnoses, started)
    finally:
        shutil.rmtree(repository / TYPESCRIPT_RAW_DIRECTORY, ignore_errors=True)


def usable_contexts(names: object, repository: Path) -> frozenset[str] | None:
    if not isinstance(names, list) or not names:
        return None

    if not all(isinstance(n, str) and n and (repository / n).is_file() for n in names):
        return None

    return frozenset(names)


def python_selection(repository: Path, eager: Selection | None = None) -> ContextSelection:
    return ContextSelection(eager or {}, PythonContexts(repository, usable_contexts))


def suite_size(selection: Mapping) -> int:
    if isinstance(selection, ContextSelection):
        return selection.suite_size

    return len({f for lines in selection.values() for files in lines.values() for f in files})


def typescript_test_files(scan: Scan) -> list[str]:
    return [path for module in scan.modules for path in module.files if is_script_test_file(path)]


def typescript_selection(repository: Path, scan: Scan, whole: Coverage) -> Selection:
    tests = sorted(set(typescript_test_files(scan)))

    if not tests:
        return {}

    builder = SelectionBuilder()

    try:
        for number, file in enumerate(tests):
            step = Step(f"typescript {file}", by_file_command(file, number))

            try:
                run_steps(repository, [step], "a", strict=True)
            except MeasurementError as error:
                print(
                    f"recognizer-sensors: mutation: {error}; "
                    "running the whole suite for typescript",
                    file=sys.stderr,
                )

                return {}

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

            shutil.rmtree(repository / BY_FILE_DIRECTORY / str(number), ignore_errors=True)
            builder.add(file, part)

        return builder.build(whole)
    finally:
        shutil.rmtree(repository / BY_FILE_DIRECTORY, ignore_errors=True)


def kotlin_project_of(result: Path, repository: Path) -> str:
    directory = result.parent.parent.parent.parent.relative_to(repository)

    return "".join(f":{part}" for part in directory.parts)


def kotlin_result_classes(repository: Path) -> dict[tuple[str, str], set[str]]:
    found: dict[tuple[str, str], set[str]] = {}

    for result in sorted(repository.glob(KOTLIN_RESULTS_GLOB)):
        name = result.name[len("TEST-") : -len(".xml")].split("$")[0]
        project = kotlin_project_of(result, repository)
        found.setdefault((project, name), set()).add(name)

    return found


def kotlin_declarations(repository: Path) -> dict[str, list[str]]:
    declared: dict[str, list[str]] = {}

    for path in sorted(set(listed_files(repository))):
        if not path.endswith(".kt") or not is_test_file(path):
            continue

        try:
            text = (repository / path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        package = KOTLIN_PACKAGE.search(text)

        if package is None:
            continue

        prefix = package.group(1).replace("`", "")

        for match in KOTLIN_DECLARATION.finditer(text):
            declared.setdefault(f"{prefix}.{match.group(1)}", []).append(path)

    return declared


def kotlin_class_map(repository: Path) -> dict[str, list[tuple[str, str]]] | str:
    declared = kotlin_declarations(repository)
    mapped: dict[str, list[tuple[str, str]]] = {}

    for project, name in sorted(kotlin_result_classes(repository)):
        files = declared.get(name, [])

        if len(files) != 1:
            return name

        mapped.setdefault(files[0], []).append((project, name))

    if any(len({project for project, _ in pairs}) > 1 for pairs in mapped.values()):
        return next(pairs[0][1] for pairs in mapped.values() if len({p for p, _ in pairs}) > 1)

    return mapped


def kotlin_fallback(reason: str) -> Selection:
    print(
        f"recognizer-sensors: mutation: {reason}; running the whole suite for kotlin",
        file=sys.stderr,
    )

    return {}


def kotlin_selection(repository: Path, scan: Scan, whole: Coverage) -> Selection:
    KOTLIN_CLASSES.clear()
    mapped = kotlin_class_map(repository)

    if isinstance(mapped, str):
        print(
            f"recognizer-sensors: mutation: test class {mapped} has no single test file; "
            "running the whole suite for kotlin",
            file=sys.stderr,
        )

        return {}

    if not mapped:
        return {}

    scanned = [path for module in scan.modules for path in module.files]
    builder = SelectionBuilder()

    for file in sorted(mapped):
        pairs = mapped[file]
        project = pairs[0][0]

        step = Step(f"kotlin {file}", kotlin_by_file_command(project, [n for _, n in pairs]))

        started = time.time()

        try:
            run_steps(repository, [step], "a", strict=True)
        except MeasurementError as error:
            return kotlin_fallback(str(error))

        reports = fresh_reports(repository, KOTLIN_REPORT_GLOB, started)

        if not reports:
            return kotlin_fallback(f"no coverage report for {file}")

        part = parse_jacoco(reports[0].read_text(encoding="utf-8", errors="replace"), scanned)

        if part is None:
            return kotlin_fallback(f"no coverage report for {file}")

        builder.add(file, part)

    KOTLIN_CLASSES.update(mapped)

    return builder.build(whole)


def csharp_trx_classes(directory: Path) -> set[str] | None:
    found: set[str] = set()

    for trx in sorted(directory.glob("results_*.trx")):
        try:
            root = ElementTree.parse(trx).getroot()
        except (OSError, ElementTree.ParseError):
            return None

        for element in root.iter():
            if element.tag.rpartition("}")[2] == "TestMethod" and element.get("className"):
                found.add(element.get("className"))

    return found


def csharp_declared(node, namespace: str, outer: str, found: list[str]) -> None:
    for child in node.children:
        if child.type == "file_scoped_namespace_declaration":
            name = child.child_by_field_name("name")
            namespace = name.text.decode("utf-8", errors="replace") if name else namespace
            csharp_declared(child, namespace, outer, found)
        elif child.type == "namespace_declaration":
            name = child.child_by_field_name("name")
            inner = name.text.decode("utf-8", errors="replace") if name else ""
            joined = f"{namespace}.{inner}" if namespace and inner else namespace or inner
            body = child.child_by_field_name("body")

            if body is not None:
                csharp_declared(body, joined, outer, found)
        elif child.type in CSHARP_TYPES:
            name = child.child_by_field_name("name")

            if name is None:
                continue

            text = name.text.decode("utf-8", errors="replace")
            qualified = (
                f"{outer}+{text}" if outer else (f"{namespace}.{text}" if namespace else text)
            )
            found.append(qualified)
            body = child.child_by_field_name("body")

            if body is not None:
                csharp_declared(body, namespace, qualified, found)


def csharp_declarations(repository: Path, names: set[str]) -> dict[str, list[str]]:
    simple = {name.rpartition("+")[2].rpartition(".")[2] for name in names}
    declared: dict[str, list[str]] = {}

    for path in sorted(set(listed_files(repository))):
        if not path.endswith(".cs"):
            continue

        try:
            data = (repository / path).read_bytes()
        except OSError:
            continue

        text = data.decode("utf-8", errors="replace")

        if not any(name in text for name in simple):
            continue

        found: list[str] = []
        csharp_declared(parse("csharp", data).root_node, "", "", found)

        for name in found:
            declared.setdefault(name, []).append(path)

    return declared


def csharp_class_map(repository: Path, classes: set[str]) -> dict[str, list[str]] | str:
    for name in sorted(classes):
        if not CSHARP_CLASS_NAME.match(name):
            return name

    declared = csharp_declarations(repository, classes)
    mapped: dict[str, list[str]] = {}

    for name in sorted(classes):
        files = declared.get(name, [])

        if len(files) != 1:
            return name

        mapped.setdefault(files[0], []).append(name)

    return mapped


def csharp_fallback(reason: str) -> Selection:
    print(
        f"recognizer-sensors: mutation: {reason}; running the whole suite for csharp",
        file=sys.stderr,
    )

    return {}


def csharp_selection(repository: Path, whole: Coverage) -> Selection:
    CSHARP_CLASSES.clear()
    classes = csharp_trx_classes(repository / CSHARP_DIRECTORY)

    if classes is None:
        return csharp_fallback("the csharp test results could not be read")

    if not classes:
        return {}

    mapped = csharp_class_map(repository, classes)

    if isinstance(mapped, str):
        return csharp_fallback(f"test class {mapped} has no single test file")

    builder = SelectionBuilder()

    try:
        for number, file in enumerate(sorted(mapped)):
            directory = repository / CSHARP_BY_FILE_DIRECTORY / str(number)
            shutil.rmtree(directory, ignore_errors=True)
            step = Step(f"csharp {file}", csharp_by_file_command(number, mapped[file]))

            try:
                run_steps(repository, [step], "a", strict=True)
            except MeasurementError as error:
                return csharp_fallback(str(error))

            ran = csharp_trx_classes(directory)

            if ran != set(mapped[file]):
                return csharp_fallback(
                    f"the csharp run for {file} did not execute exactly its classes"
                )

            reports = sorted(directory.glob("*/coverage.info"))

            if not reports:
                return csharp_fallback(f"no coverage report for {file}")

            for report in reports:
                try:
                    part = parse_lcov(report.read_text(encoding="utf-8"), repository)
                except (OSError, ValueError):
                    return csharp_fallback(f"no coverage report for {file}")

                builder.add(file, part)

            shutil.rmtree(directory, ignore_errors=True)

        CSHARP_CLASSES.update(mapped)

        return builder.build(whole)
    finally:
        shutil.rmtree(repository / CSHARP_BY_FILE_DIRECTORY, ignore_errors=True)


def rust_target_kind(kinds: list) -> str | None:
    if "test" in kinds:
        return "test"

    if "bin" in kinds:
        return "bin"

    if any(kind in RUST_LIB_KINDS for kind in kinds):
        return "lib"

    return None


def rust_units(repository: Path) -> dict[str, tuple[str, str, str]] | str:
    try:
        result = subprocess.run(
            ["cargo", "metadata", "--no-deps", "--format-version", "1"],
            cwd=repository,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return "cargo metadata did not start"

    if result.returncode != 0:
        return f"cargo metadata exited {result.returncode}"

    try:
        document = json.loads(result.stdout)
        defaults = set(document["workspace_default_members"])
        packages = [p for p in document["packages"] if p["id"] in defaults]
    except (ValueError, KeyError, TypeError):
        return "cargo metadata printed no usable document"

    root = repository.resolve()
    units: dict[str, tuple[str, str, str]] = {}

    try:
        for package in packages:
            for target in package["targets"]:
                kind = rust_target_kind(target["kind"])

                if kind is None or not target.get("test") or target.get("required-features"):
                    continue

                if not RUST_NAME.match(package["name"]) or not RUST_NAME.match(target["name"]):
                    return f"rust target {package['name']}/{target['name']} has an unusable name"

                try:
                    name = Path(target["src_path"]).resolve().relative_to(root).as_posix()
                except ValueError:
                    return f"rust target {target['src_path']} is outside the repository"

                if name in units:
                    return f"rust target {name} is named twice"

                units[name] = (package["name"], kind, target["name"])
    except (KeyError, TypeError, AttributeError):
        return "cargo metadata printed no usable document"

    return units


def rust_fallback(reason: str) -> Selection:
    print(
        f"recognizer-sensors: mutation: {reason}; running the whole suite for rust",
        file=sys.stderr,
    )

    return {}


def rust_selection(repository: Path, whole: Coverage) -> Selection:
    RUST_UNITS.clear()
    shutil.rmtree(repository / RUST_BY_TARGET_DIRECTORY, ignore_errors=True)
    units = rust_units(repository)

    if isinstance(units, str):
        return rust_fallback(units)

    if not units:
        return {}

    (repository / RUST_BY_TARGET_DIRECTORY).mkdir(parents=True, exist_ok=True)
    builder = SelectionBuilder()

    try:
        for number, name in enumerate(sorted(units)):
            step = Step(f"rust {name}", rust_by_target_command(number, units[name]))

            try:
                run_steps(repository, [step], "a", strict=True)
            except MeasurementError as error:
                return rust_fallback(str(error))

            report = repository / RUST_BY_TARGET_DIRECTORY / f"{number}.lcov"

            try:
                part = parse_lcov(report.read_text(encoding="utf-8"), repository)
            except (OSError, ValueError):
                return rust_fallback(f"no coverage report for {name}")

            report.unlink(missing_ok=True)
            builder.add(name, part)

        RUST_UNITS.update(units)

        return builder.build(whole)
    finally:
        shutil.rmtree(repository / RUST_BY_TARGET_DIRECTORY, ignore_errors=True)


def collect_coverage_with_tests(
    repository: Path, scans: list[Scan], coverage: str | None
) -> tuple[Coverage, Selection | ContextSelection]:
    if not scans:
        return {}, {}

    if coverage is not None:
        return collect_coverage(repository, scans, None, coverage), {}

    steps, sources = plan(repository, scans, None, None, contexts=True)
    clear_cached_reports(repository, sources)
    clear_stale_kotlin_reports(repository, scans, sources, steps)
    (repository / PYTHON_DATA).unlink(missing_ok=True)
    (repository / LEGACY_CONTEXTS_PATH).unlink(missing_ok=True)
    shutil.rmtree(repository / BY_FILE_DIRECTORY, ignore_errors=True)
    shutil.rmtree(repository / KOTLIN_BY_FILE_DIRECTORY, ignore_errors=True)
    shutil.rmtree(repository / CSHARP_BY_FILE_DIRECTORY, ignore_errors=True)

    for stale in (repository / CSHARP_DIRECTORY).glob("results_*.trx"):
        stale.unlink(missing_ok=True)

    started = time.time() if steps else None
    results = run_steps(repository, steps)
    merged = read_reports(repository, sources, scans, steps, results, None, started)
    shutil.rmtree(repository / TYPESCRIPT_RAW_DIRECTORY, ignore_errors=True)
    selection: Selection = {}

    python = False

    for scan in scans:
        if scan.language == "python":
            python = True
        elif scan.language == "typescript":
            selection.update(typescript_selection(repository, scan, merged))
        elif scan.language == "kotlin":
            selection.update(kotlin_selection(repository, scan, merged))
        elif scan.language == "csharp":
            selection.update(csharp_selection(repository, merged))
        elif scan.language == "rust":
            selection.update(rust_selection(repository, merged))

    if python:
        return merged, python_selection(repository, selection)

    return merged, selection
