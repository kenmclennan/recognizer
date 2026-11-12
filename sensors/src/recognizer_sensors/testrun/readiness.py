import json
import os
import re
import shlex
import subprocess
import time
from pathlib import Path

from recognizer_sensors.scans import Scan, read_scans
from recognizer_sensors.settings import Refusal
from recognizer_sensors.testrun.reports import (
    LOG,
    Source,
    coverage_counts,
    has_well_formed_report,
    last_meaningful_line,
    read_source,
)
from recognizer_sensors.testrun.suites import (
    Suite,
    login_shell,
    report_pattern,
    run_suite,
    selected,
    shell_script,
    source_of,
)

PREFIX = "recognizer-check:"

SHELL_TIMEOUT_SECONDS = 60

OUTPUT_LIMIT = 200

COVERLET = "coverlet.collector"

TEST_SDK = "microsoft.net.test.sdk"

BUILD_PROPERTY_FILES = (
    "Directory.Build.props",
    "Directory.Build.targets",
    "Directory.Packages.props",
)

GRADLE_FILE = re.compile(r"(\.gradle(\.kts)?|\.versions\.toml)$")

SKIPPED_FOLDERS = {"bin", "obj", "node_modules", ".git", ".recognizer", "build", ".venv"}

PYTHON_PROBE = (
    "py=python; command -v python >/dev/null 2>&1 || py=python3; "
    'if command -v "$py" >/dev/null 2>&1; then '
    "for m in pytest coverage pytest_cov; do "
    '"$py" -c "import $m" >/dev/null 2>&1 || echo "' + PREFIX + ' missing $m"; done; '
    "else echo '" + PREFIX + " missing python'; fi"
)

NODE_SCRIPT = (
    "const found = (name) => {"
    " try { import.meta.resolve(name); return true; } catch { return false; } };"
    "const say = (name) => console.log('" + PREFIX + " missing ' + name);"
    "if (!found('{runner}')) say('{runner}');"
    "{extra}"
)

VITEST_EXTRA = (
    "if (!found('@vitest/coverage-v8') && !found('@vitest/coverage-istanbul')) say('coverage');"
)

RUST_PROBE = (
    "cargo llvm-cov --version >/dev/null 2>&1 || echo '" + PREFIX + " missing llvm-cov'; "
    "rustup component list --installed 2>/dev/null | grep -q '^llvm-tools' "
    "|| echo '" + PREFIX + " missing llvm-tools'"
)

PYTHON_GAPS = {
    "pytest": ("pytest-missing", "pytest is not installed in the activated environment"),
    "coverage": ("coverage-missing", "coverage is not installed in the activated environment"),
    "pytest_cov": (
        "pytest-cov-missing",
        "pytest-cov is not installed in the activated environment",
    ),
    "python": ("python-missing", "neither python nor python3 is on the PATH"),
}

TYPESCRIPT_GAPS = {
    "vitest": ("vitest-missing", "vitest is not installed"),
    "coverage": (
        "vitest-coverage-missing",
        "neither @vitest/coverage-v8 nor @vitest/coverage-istanbul is installed",
    ),
    "jest": ("jest-missing", "jest is not installed"),
    "node": ("node-missing", "node is not on the PATH"),
}

RUST_GAPS = {
    "llvm-cov": ("llvm-cov-missing", "cargo-llvm-cov is not installed"),
    "llvm-tools": ("llvm-tools-missing", "the llvm-tools component is not installed"),
}


def gap(code: str, suite: str | None, line: str) -> dict:
    return {"code": code, "suite": suite, "line": line}


def suite_gap(code: str, suite: Suite, line: str) -> dict:
    return gap(code, suite.name, f"suite {suite.name}: {line}")


def typescript_probe(suite: Suite) -> str:
    runner = suite.runner or "vitest"
    extra = VITEST_EXTRA if runner == "vitest" else ""
    script = NODE_SCRIPT.replace("{runner}", runner).replace("{extra}", extra)

    return (
        "if command -v node >/dev/null 2>&1; "
        f"then node --input-type=module -e {shlex.quote(script)}; "
        f"else echo '{PREFIX} missing node'; fi"
    )


def probe_of(suite: Suite) -> str:
    probe = {
        "python": PYTHON_PROBE,
        "rust": RUST_PROBE,
    }.get(suite.language)

    if suite.language == "typescript":
        probe = typescript_probe(suite)

    body = f"echo '{PREFIX} start'"

    return body if probe is None else f"{body}; {probe}"


def missing_tools(output: str) -> list[str]:
    tools = []

    for line in output.splitlines():
        line = line.strip()

        if line.startswith(f"{PREFIX} missing "):
            tools.append(line[len(f"{PREFIX} missing ") :].strip())

    return tools


def started(output: str) -> bool:
    return any(line.strip() == f"{PREFIX} start" for line in output.splitlines())


def shell_gap(suite: Suite, output: str, timed_out: bool) -> dict:
    if timed_out:
        reason = f"did not finish within {SHELL_TIMEOUT_SECONDS} seconds"
    else:
        last = last_meaningful_line(
            "\n".join(line for line in output.splitlines() if not line.startswith(PREFIX))
        )
        reason = f"failed: {last[:OUTPUT_LIMIT]}" if last else "failed"

    return suite_gap("activate-failed", suite, f"the activate command {reason}")


def ask_shell(repository: Path, suite: Suite) -> tuple[str, bool, bool]:
    shell = login_shell()

    try:
        result = subprocess.run(
            [shell, "-ilc", shell_script(suite, probe_of(suite))],
            cwd=repository,
            env={**os.environ, **suite.env},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=SHELL_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as expired:
        output = (expired.stdout or b"").decode("utf-8", errors="replace")

        return output, False, True
    except OSError:
        return "", False, False

    return result.stdout.decode("utf-8", errors="replace"), True, False


def tool_gaps(suite: Suite, tools: list[str]) -> list[dict]:
    table = {
        "python": PYTHON_GAPS,
        "typescript": TYPESCRIPT_GAPS,
        "rust": RUST_GAPS,
    }.get(suite.language, {})

    return [suite_gap(table[tool][0], suite, table[tool][1]) for tool in tools if tool in table]


def package_names(directory: Path) -> set[str]:
    try:
        manifest = json.loads((directory / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()

    if not isinstance(manifest, dict):
        return set()

    names: set[str] = set()

    for key in ("dependencies", "devDependencies"):
        section = manifest.get(key)

        if isinstance(section, dict):
            names.update(section)

    return names


def runner_conflict(suite: Suite, directory: Path) -> list[dict]:
    names = package_names(directory)

    if suite.language == "typescript" and {"vitest", "jest"} <= names:
        return [
            suite_gap(
                "runner-conflict",
                suite,
                "both vitest and jest are listed in package.json, and only one runner is supported",
            )
        ]

    return []


def listed_files(repository: Path, directory: Path) -> list[Path]:
    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(repository),
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                str(directory.relative_to(repository)) or ".",
            ],
            capture_output=True,
            check=False,
        )
    except OSError:
        result = None

    if result is not None and result.returncode == 0:
        return [
            repository / name
            for name in result.stdout.decode("utf-8", errors="replace").split("\0")
            if name
        ]

    return walked_files(directory)


def walked_files(directory: Path) -> list[Path]:
    found = []

    for current, folders, names in os.walk(directory):
        folders[:] = [name for name in folders if name not in SKIPPED_FOLDERS]
        found.extend(Path(current) / name for name in names)

    return found


def names_jacoco(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return False

    return "jacoco" in text and "xml" in text


def nearest_gradlew(repository: Path, directory: Path) -> Path | None:
    current = directory

    while True:
        wrapper = current / "gradlew"

        if wrapper.is_file() and os.access(wrapper, os.X_OK):
            return wrapper

        if current == repository or repository not in current.parents:
            return None

        current = current.parent


def ancestor_build_files(directory: Path, top: Path) -> list[Path]:
    found = []
    current = directory

    while current != top and top in current.parents:
        current = current.parent
        found.extend(
            path for path in current.iterdir() if path.is_file() and GRADLE_FILE.search(path.name)
        )

    return found


def kotlin_gaps(repository: Path, suite: Suite, directory: Path) -> list[dict]:
    wrapper = nearest_gradlew(repository, directory)

    if wrapper is None:
        return [suite_gap("gradlew-missing", suite, "gradlew is missing or not executable")]

    build_files = [
        path for path in listed_files(repository, directory) if GRADLE_FILE.search(path.name)
    ]
    build_files.extend(ancestor_build_files(directory, wrapper.parent))

    if not any(names_jacoco(path) for path in build_files):
        return [
            suite_gap(
                "jacoco-missing", suite, "the JaCoCo plugin with its XML report is not configured"
            )
        ]

    return []


def names_coverlet(path: Path) -> bool:
    try:
        return COVERLET in path.read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return False


def is_test_project(path: Path) -> bool:
    try:
        return TEST_SDK in path.read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return False


def inherits_coverlet(repository: Path, directory: Path) -> bool:
    current = directory

    while True:
        if any(names_coverlet(current / name) for name in BUILD_PROPERTY_FILES):
            return True

        if current == repository or repository not in current.parents:
            return False

        current = current.parent


def csharp_gaps(repository: Path, suite: Suite, directory: Path) -> list[dict]:
    gaps = []
    projects = sorted(path for path in walked_files(directory) if path.suffix == ".csproj")

    for project in projects:
        if not is_test_project(project):
            continue

        if names_coverlet(project) or inherits_coverlet(repository, project.parent):
            continue

        shown = project.relative_to(repository).as_posix()
        gaps.append(
            suite_gap(
                "coverlet-missing",
                suite,
                f"the test project {shown} does not reference {COVERLET}",
            )
        )

    return gaps


def file_gaps(repository: Path, suite: Suite, directory: Path) -> list[dict]:
    if suite.language == "kotlin":
        return kotlin_gaps(repository, suite, directory)

    if suite.language == "csharp":
        return csharp_gaps(repository, suite, directory)

    return runner_conflict(suite, directory)


def check_suite(repository: Path, suite: Suite) -> list[dict]:
    directory = repository / suite.directory

    if not directory.is_dir():
        return [
            suite_gap("directory-missing", suite, f"the directory {suite.directory} does not exist")
        ]

    output, answered, timed_out = ask_shell(repository, suite)

    if not (answered and started(output)):
        return [shell_gap(suite, output, timed_out)]

    return [*tool_gaps(suite, missing_tools(output)), *file_gaps(repository, suite, directory)]


def has_well_formed_jacoco(
    repository: Path, source: Source, files: list[str], started_at: float
) -> bool:
    return source.format == "jacoco" and has_well_formed_report(
        repository, source, files, started_at
    )


def unmatched_gap(suite: Suite, where: str, scanned: bool) -> dict:
    if not scanned:
        return suite_gap(
            "coverage-unmatched",
            suite,
            f"the coverage report at {where} parses, but there is no scan to match it against; "
            "run recognizer scan first",
        )

    return suite_gap(
        "coverage-unmatched",
        suite,
        f"the coverage report at {where} parses, but its paths match no file in the scan",
    )


LANGUAGE_NAMES = {
    "python": "Python",
    "typescript": "TypeScript",
    "kotlin": "Kotlin",
    "rust": "Rust",
    "csharp": "C#",
}


def partial_note(suite: Suite, covered: int, expected: int) -> dict:
    language = LANGUAGE_NAMES.get(suite.language, suite.language)
    noun = "file" if expected == 1 else "files"

    return gap(
        "coverage-partial",
        suite.name,
        f"suite {suite.name}: the coverage report covers {covered} of {expected} "
        f"scanned {language} {noun}",
    )


def run_gap(
    repository: Path, suite: Suite, files: list[str], stream, scans: list[Scan]
) -> tuple[dict | None, dict | None]:
    started_at = time.time()

    try:
        returncode, _ = run_suite(repository, suite, stream)
    except Refusal:
        return suite_gap("activate-failed", suite, "the login shell could not be started"), None

    where = report_pattern(suite)
    source = source_of(suite)
    coverage = read_source(repository, source, files, started_at)

    if coverage is None:
        cause = f"the suite exited {returncode} and left" if returncode else "the suite left"

        return suite_gap("coverage-missing", suite, f"{cause} no coverage report at {where}"), None

    if not coverage and has_well_formed_jacoco(repository, source, files, started_at):
        return unmatched_gap(suite, where, bool(files)), None

    if not coverage:
        return (
            suite_gap(
                "coverage-unreadable", suite, f"the coverage report at {where} does not parse"
            ),
            None,
        )

    covered, expected = coverage_counts(coverage, source, suite.language, scans)

    if covered < expected:
        return None, partial_note(suite, covered, expected)

    return None, None


def run_gaps(repository: Path, suites: list[Suite]) -> tuple[list[dict], list[dict]]:
    scans = read_scans(repository)
    files = [path for scan in scans for module in scan.modules for path in module.files]
    log = repository / LOG
    log.parent.mkdir(parents=True, exist_ok=True)
    found: list[dict] = []
    notes: list[dict] = []

    with log.open("w", encoding="utf-8") as stream:
        for suite in suites:
            result, note = run_gap(repository, suite, files, stream, scans)

            if result is not None:
                found.append(result)

            if note is not None:
                notes.append(note)

    return found, notes


def check(
    repository: Path, settings: dict, run: bool, names: list[str] | None = None
) -> list[dict]:
    return check_with_notes(repository, settings, run, names)[0]


def check_with_notes(
    repository: Path, settings: dict, run: bool, names: list[str] | None = None
) -> tuple[list[dict], list[dict]]:
    raw = settings.get("suites")

    if raw is None:
        return (
            [
                gap(
                    "no-test-suites",
                    None,
                    "no test suites are configured in .recognizer/config.yaml",
                )
            ],
            [],
        )

    suites = list(selected((Suite(**item) for item in raw), names))
    gaps: list[dict] = []
    clean: list[Suite] = []

    for suite in suites:
        found = check_suite(repository, suite)
        gaps.extend(found)

        if not found:
            clean.append(suite)

    notes: list[dict] = []

    if run:
        found, notes = run_gaps(repository, clean)
        gaps.extend(found)

    return gaps, notes
