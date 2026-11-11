import json
import re
import shlex
import shutil
import sys
import time
import xml.etree.ElementTree as ElementTree
from collections.abc import Mapping
from pathlib import Path

from recognizer_sensors.crap.jacoco import merge_coverage, parse_jacoco
from recognizer_sensors.crap.lcov import Coverage, parse_lcov
from recognizer_sensors.hashes import listed_files
from recognizer_sensors.mutation import commands
from recognizer_sensors.mutation.commands import (
    csharp_class_command,
    kotlin_class_command,
    rust_by_target_command,
)
from recognizer_sensors.mutation.runner import (
    STOP,
    StoppedBeforeMutation,
    copy_repository,
    run_test_command,
)
from recognizer_sensors.mutation.test_files import is_test_file
from recognizer_sensors.parsing import parse
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import MeasurementError, Refusal, diagnose
from recognizer_sensors.testrun.contexts import PYTHON_DATA, ContextSelection, PythonContexts
from recognizer_sensors.testrun.failures import (
    failing_names,
    mutation_tests_failed,
    not_installed,
    suite_failed,
)
from recognizer_sensors.testrun.reports import (
    LOG,
    covers_nothing,
    exit_reason,
    fresh_reports,
    read_source,
)
from recognizer_sensors.testrun.selection import Selection, SelectionBuilder
from recognizer_sensors.testrun.suites import (
    Suite,
    directory_of,
    login_shell,
    report_pattern,
    source_of,
    unavailable,
)

KOTLIN_REPORT_GLOB = "**/build/reports/jacoco/test/jacocoTestReport.xml"

KOTLIN_RESULTS_GLOB = "**/build/test-results/test/TEST-*.xml"

CSHARP_TRX_GLOB = "**/TestResults/results_*.trx"

CSHARP_BY_FILE_DIRECTORY = ".recognizer/cache/coverage/csharp/by-file"

RUST_BY_TARGET_DIRECTORY = ".recognizer/cache/coverage/rust/by-target"

CARRY_HINT = (
    "recognizer-sensors: mutation: the suite failed in its repository copy; untracked folders "
    "it needs (a venv, node_modules, build output) belong under carry in sensors.mutation"
)

KOTLIN_PACKAGE = re.compile(r"^package\s+([\w.`]+)", re.MULTILINE)

KOTLIN_DECLARATION = re.compile(
    r"^(?:@\w+(?:\([^)]*\))?\s+)*"
    r"(?:(?:public|internal|private|open|abstract|final|data|sealed|inner|enum|annotation|value)\s+)*"
    r"(?:class|object)\s+(\w+)",
    re.MULTILINE,
)

CSHARP_CLASS_NAME = re.compile(r"^[A-Za-z0-9_.+]+$")

CSHARP_TYPES = ("class_declaration", "record_declaration", "struct_declaration")

RUST_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]*$")

RUST_LIB_KINDS = {"lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"}

CARGO_METADATA = "cargo metadata --no-deps --format-version 1 2>/dev/null"


def record(repository: Path, label: str, command: str, output: str) -> None:
    log = repository / LOG
    log.parent.mkdir(parents=True, exist_ok=True)

    with log.open("a", encoding="utf-8") as stream:
        stream.write(f"== {label}: {command}\n{output}\n")


def warm_step(repository: Path, copy: Path, suite: Suite, label: str, command: list[str]) -> str:
    result = run_test_command(command, copy, None, suite=suite)

    if STOP.is_set():
        raise StoppedBeforeMutation

    record(repository, label, shlex.join(command), result.output)

    if result.exit_code is None:
        raise not_installed(command[0])

    if result.exit_code != 0:
        raise MeasurementError(
            exit_reason(f"the {label} test command", result.exit_code, result.output)
        )

    return result.output


def selection_dropped(language: str, suites: list[Suite]) -> Selection:
    if len(suites) > 1:
        reason = f"{language} has {len(suites)} suites"
    else:
        reason = f"{language} runs from {suites[0].directory}"

    print(
        f"recognizer-sensors: mutation: {reason}; running the whole suite for {language}",
        file=sys.stderr,
    )

    return {}


def suite_size(selection: Mapping) -> int:
    if isinstance(selection, ContextSelection):
        return selection.suite_size

    return len({f for lines in selection.values() for files in lines.values() for f in files})


def kotlin_project_of(result: Path, copy: Path) -> str:
    directory = result.parent.parent.parent.parent.relative_to(copy)

    return "".join(f":{part}" for part in directory.parts)


def kotlin_result_classes(copy: Path) -> dict[tuple[str, str], set[str]]:
    found: dict[tuple[str, str], set[str]] = {}

    for result in sorted(copy.glob(KOTLIN_RESULTS_GLOB)):
        name = result.name[len("TEST-") : -len(".xml")].split("$")[0]
        project = kotlin_project_of(result, copy)
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


def kotlin_class_map(repository: Path, copy: Path) -> dict[str, list[tuple[str, str]]] | str:
    declared = kotlin_declarations(repository)
    mapped: dict[str, list[tuple[str, str]]] = {}

    for project, name in sorted(kotlin_result_classes(copy)):
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


def kotlin_selection(
    repository: Path, copy: Path, suite: Suite, scan: Scan, whole: Coverage
) -> Selection:
    commands.KOTLIN_CLASSES.clear()
    mapped = kotlin_class_map(repository, copy)

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
        started = time.time()

        try:
            warm_step(
                repository,
                copy,
                suite,
                f"kotlin {file}",
                kotlin_class_command(project, [n for _, n in pairs]),
            )
        except MeasurementError as error:
            return kotlin_fallback(str(error))

        reports = fresh_reports(copy, KOTLIN_REPORT_GLOB, started)

        if not reports:
            return kotlin_fallback(f"no coverage report for {file}")

        part = parse_jacoco(
            reports[0].read_text(encoding="utf-8", errors="replace"),
            scanned,
            reports[0].relative_to(copy).as_posix(),
        )

        if part is None:
            return kotlin_fallback(f"no coverage report for {file}")

        builder.add(file, part)

    commands.KOTLIN_CLASSES.update(mapped)

    return builder.build(whole)


def csharp_trx_classes(files: list[Path]) -> set[str] | None:
    found: set[str] = set()

    for trx in sorted(files):
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


def csharp_selection(
    repository: Path, copy: Path, suite: Suite, whole: Coverage, started: float
) -> Selection:
    commands.CSHARP_CLASSES.clear()
    floor = int(started * 1_000_000_000)
    results = [p for p in copy.glob(CSHARP_TRX_GLOB) if p.stat().st_mtime_ns >= floor]
    classes = csharp_trx_classes(results) if results else None

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
            directory = copy / CSHARP_BY_FILE_DIRECTORY / str(number)
            shutil.rmtree(directory, ignore_errors=True)

            try:
                warm_step(
                    repository,
                    copy,
                    suite,
                    f"csharp {file}",
                    csharp_class_command(number, mapped[file]),
                )
            except MeasurementError as error:
                return csharp_fallback(str(error))

            ran = csharp_trx_classes(sorted(directory.glob("results_*.trx")))

            if ran != set(mapped[file]):
                return csharp_fallback(
                    f"the csharp run for {file} did not execute exactly its classes"
                )

            reports = sorted(directory.glob("*/coverage.info"))

            if not reports:
                return csharp_fallback(f"no coverage report for {file}")

            for report in reports:
                try:
                    part = parse_lcov(report.read_text(encoding="utf-8"), copy)
                except (OSError, ValueError):
                    return csharp_fallback(f"no coverage report for {file}")

                builder.add(file, part)

            shutil.rmtree(directory, ignore_errors=True)

        commands.CSHARP_CLASSES.update(mapped)

        return builder.build(whole)
    finally:
        shutil.rmtree(copy / CSHARP_BY_FILE_DIRECTORY, ignore_errors=True)


def rust_target_kind(kinds: list) -> str | None:
    if "test" in kinds:
        return "test"

    if "bin" in kinds:
        return "bin"

    if any(kind in RUST_LIB_KINDS for kind in kinds):
        return "lib"

    return None


def metadata_document(output: str) -> dict:
    start = output.find("{")

    while start != -1:
        try:
            document, _ = json.JSONDecoder().raw_decode(output, start)
        except ValueError:
            start = output.find("{", start + 1)
            continue

        if isinstance(document, dict):
            return document

        start = output.find("{", start + 1)

    raise ValueError("no document")


def rust_units(copy: Path, suite: Suite) -> dict[str, tuple[str, str, str]] | str:
    result = run_test_command(CARGO_METADATA, copy, None, suite=suite)

    if result.exit_code is None:
        return "cargo metadata did not start"

    if result.exit_code != 0:
        return f"cargo metadata exited {result.exit_code}"

    try:
        document = metadata_document(result.output)
        defaults = set(document["workspace_default_members"])
        packages = [p for p in document["packages"] if p["id"] in defaults]
    except (ValueError, KeyError, TypeError):
        return "cargo metadata printed no usable document"

    root = copy.resolve()
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


def rust_selection(repository: Path, copy: Path, suite: Suite, whole: Coverage) -> Selection:
    commands.RUST_UNITS.clear()
    shutil.rmtree(copy / RUST_BY_TARGET_DIRECTORY, ignore_errors=True)
    units = rust_units(copy, suite)

    if isinstance(units, str):
        return rust_fallback(units)

    if not units:
        return {}

    (copy / RUST_BY_TARGET_DIRECTORY).mkdir(parents=True, exist_ok=True)
    builder = SelectionBuilder()

    try:
        for number, name in enumerate(sorted(units)):
            try:
                warm_step(
                    repository,
                    copy,
                    suite,
                    f"rust {name}",
                    rust_by_target_command(number, units[name]),
                )
            except MeasurementError as error:
                return rust_fallback(str(error))

            report = copy / RUST_BY_TARGET_DIRECTORY / f"{number}.lcov"

            try:
                part = parse_lcov(report.read_text(encoding="utf-8"), copy)
            except (OSError, ValueError):
                return rust_fallback(f"no coverage report for {name}")

            report.unlink(missing_ok=True)
            builder.add(name, part)

        commands.RUST_UNITS.update(units)

        return builder.build(whole)
    finally:
        shutil.rmtree(copy / RUST_BY_TARGET_DIRECTORY, ignore_errors=True)


def python_data_path(index: int) -> str:
    return PYTHON_DATA if index == 0 else PYTHON_DATA.replace(".data", f"-{index}.data")


def outside_the_copy(copy: Path, repository: Path, reports: list[Path]) -> str | None:
    original = repository.resolve()
    inside = copy.resolve()

    for report in reports:
        try:
            text = report.read_text(encoding="utf-8")
        except (OSError, ValueError):
            continue

        for line in text.splitlines():
            if not line.startswith("SF:"):
                continue

            raw = line[3:].strip()

            if not raw.startswith("/"):
                continue

            path = Path(raw).resolve()

            if "site-packages" in path.parts:
                continue

            if path.is_relative_to(original) and not path.is_relative_to(inside):
                return str(path)

    return None


def editable_refusal(suite: Suite, path: str) -> Refusal:
    return Refusal(
        diagnose(
            "coverage-unavailable",
            f"coverage unavailable: the {suite.name} suite imported {path} from outside its "
            "repository copy, so mutants would not be seen; set PYTHONPATH in the suite's env "
            "to a path inside the repository (resolved inside the copy)",
        )
    )


def run_suite_in(
    repository: Path, copy: Path, suite: Suite, command: str, extra: dict[str, str]
) -> tuple[int, str]:
    result = run_test_command(command, copy, None, suite=suite, extra=extra)

    if STOP.is_set():
        raise StoppedBeforeMutation

    record(repository, suite.name, command, result.output)

    if result.exit_code is None:
        raise Refusal(diagnose("tool-missing", f"{login_shell()} could not be started"))

    return result.exit_code, result.output


def coverage_run(
    repository: Path,
    scans: list[Scan],
    suites: tuple[Suite, ...] | list[Suite],
    work: Path,
    carry: tuple[str, ...] = (),
) -> tuple[Coverage, Selection | ContextSelection]:
    scanned = [scan.language for scan in scans]
    runnable = [suite for suite in suites if suite.language in scanned]

    if not runnable:
        return {}, {}

    copy = work / "warmup"

    if carry:
        copy_repository(repository, copy, carry)
    else:
        copy_repository(repository, copy)

    log = repository / LOG
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text("", encoding="utf-8")
    files = [path for scan in scans for module in scan.modules for path in module.files]
    merged: Coverage = {}
    readers: list[PythonContexts] = []
    started_at: dict[str, float] = {}

    for suite in runnable:
        command = suite.command
        extra: dict[str, str] = {}
        data = None

        if suite.language == "python":
            data = python_data_path(len(readers))
            (copy / data).parent.mkdir(parents=True, exist_ok=True)
            extra["COVERAGE_FILE"] = str(copy / data)
            command = f"{command} --cov-context=test"
        elif suite.language == "csharp":
            command = f'{command} --logger "trx;LogFilePrefix=results"'

        started = time.time()
        started_at.setdefault(suite.language, started)
        exit_code, output = run_suite_in(repository, copy, suite, command, extra)

        if suite_failed(suite.language, exit_code, output):
            print(CARRY_HINT, file=sys.stderr)
            names = (
                []
                if suite.language == "csharp"
                else failing_names(copy, suite.language, output, directory_of(suite))
            )

            raise Refusal(mutation_tests_failed(names))

        source = source_of(suite)
        where = report_pattern(suite)

        if suite.language == "python":
            found = outside_the_copy(copy, repository, fresh_reports(copy, where, started))

            if found is not None:
                raise editable_refusal(suite, found)

        part = read_source(copy, source, files, started)

        if part is None:
            raise Refusal(unavailable(f"the {suite.name} suite left no coverage report at {where}"))

        merge_coverage(merged, part)

        if covers_nothing(part, source, suite.language, scans):
            raise Refusal(unavailable(f"the {suite.name} suite produced an empty coverage report"))

        if data is not None:
            readers.append(PythonContexts(copy, directory=directory_of(suite), data=data))

    selection: Selection = {}

    for scan in scans:
        owners = [suite for suite in runnable if suite.language == scan.language]
        language = scan.language

        if language in ("python", "typescript") or not owners:
            continue

        if len(owners) != 1 or directory_of(owners[0]):
            selection.update(selection_dropped(language, owners))
        elif language == "kotlin":
            selection.update(kotlin_selection(repository, copy, owners[0], scan, merged))
        elif language == "csharp":
            selection.update(
                csharp_selection(repository, copy, owners[0], merged, started_at[language])
            )
        elif language == "rust":
            selection.update(rust_selection(repository, copy, owners[0], merged))

    if readers:
        return merged, ContextSelection(selection, readers)

    return merged, selection
