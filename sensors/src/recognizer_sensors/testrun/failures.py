import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path

from recognizer_sensors.settings import MAX_FAILING_NAMES, diagnose

KOTLIN_RESULTS_GLOB = "**/build/test-results/test/TEST-*.xml"

COVERAGE_ROOT = ".recognizer/cache/coverage"

CSHARP_RESULTS_DIRECTORY = f"{COVERAGE_ROOT}/csharp"

PYTEST_FAILURE = re.compile(r"^(?:FAILED|ERROR) (.+?)(?: - .*)?$", re.MULTILINE)

LIBTEST_FAILURE = re.compile(r"^test (\S+) \.\.\. FAILED$", re.MULTILINE)

LIBTEST_SUMMARY = "test result: FAILED"


def log_names(language: str | None, output: str) -> list[str]:
    names: list[str] = []

    if language in (None, "python"):
        names.extend(match.group(1).strip() for match in PYTEST_FAILURE.finditer(output))

    if language in (None, "rust"):
        names.extend(match.group(1) for match in LIBTEST_FAILURE.finditer(output))

    return names


def kotlin_names(repository: Path, directory: str = "") -> list[str]:
    names: list[str] = []

    for result in sorted((repository / directory).glob(KOTLIN_RESULTS_GLOB)):
        try:
            root = ElementTree.parse(result).getroot()
        except (OSError, ElementTree.ParseError):
            continue

        for case in root.iter("testcase"):
            if case.find("failure") is not None or case.find("error") is not None:
                names.append(f"{case.get('classname', '')}.{case.get('name', '')}".strip("."))

    return names


def csharp_names(directory: Path) -> list[str]:
    names: list[str] = []

    for trx in sorted(directory.glob("results_*.trx")):
        try:
            root = ElementTree.parse(trx).getroot()
        except (OSError, ElementTree.ParseError):
            continue

        for element in root.iter():
            if element.tag.rpartition("}")[2] == "UnitTestResult" and (
                element.get("outcome") == "Failed" and element.get("testName")
            ):
                names.append(element.get("testName"))

    return names


def failing_names(
    repository: Path, language: str | None, output: str, directory: str = "", slug: str = ""
) -> list[str]:
    if language == "kotlin":
        return kotlin_names(repository, directory)

    if language == "csharp":
        folder = (
            CSHARP_RESULTS_DIRECTORY
            if not directory
            else CSHARP_RESULTS_DIRECTORY.replace(COVERAGE_ROOT, f"{COVERAGE_ROOT}/projects/{slug}")
        )

        return csharp_names(repository / folder)

    return log_names(language, output)


def suite_failed(language: str | None, returncode: int, output: str) -> bool:
    if returncode != 0:
        return True

    return language in (None, "rust") and LIBTEST_SUMMARY in output


def failing_object(names: list[str]) -> dict | None:
    if not names:
        return None

    return {"count": len(names), "names": names[:MAX_FAILING_NAMES]}


def named(names: list[str]) -> str:
    shown = names[0]

    if len(names) > 1:
        shown = f"{shown} and {len(names) - 1} more"

    return shown


def crap_tests_failed(names: list[str]) -> dict:
    if not names:
        line = "the tests failed, so coverage may read low"
    elif len(names) == 1:
        line = "1 test failed, so coverage may read low"
    else:
        line = f"{len(names)} tests failed, so coverage may read low"

    return diagnose("tests-failed", line, failing=failing_object(names))


def mutation_tests_failed(names: list[str]) -> dict:
    line = "the test suite fails before any mutation"

    if names:
        line = f"{line}: {named(names)}"

    return diagnose("tests-failed", line, failing=failing_object(names))


SIGNATURES = (
    (
        re.compile(r"llvm-tools", re.IGNORECASE),
        "llvm-tools is not installed",
        "install it with rustup component add llvm-tools-preview",
        "rustup component add llvm-tools-preview",
    ),
    (
        re.compile(r"npx canceled|npm (?:error|ERR!) network|ENOTFOUND|EAI_AGAIN"),
        "c8 could not be fetched",
        "check the network, c8 is fetched by npx",
        "check the network, c8 is fetched by npx",
    ),
)


def known_cause(outputs: list[str]) -> tuple[str, str, str] | None:
    for pattern, cause, sentence, fix in SIGNATURES:
        if any(pattern.search(output) for output in outputs):
            return cause, sentence, fix

    return None
