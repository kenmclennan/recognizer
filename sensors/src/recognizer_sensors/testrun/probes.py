import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from recognizer_sensors.hashes import listed_files
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import diagnose
from recognizer_sensors.testrun.profiles import python_lock, tool_environment, vitest_project
from recognizer_sensors.testrun.projects import Project, ancestors, resolve

COVERLET = "coverlet.collector"

BUILD_PROPERTY_FILES = (
    "Directory.Build.props",
    "Directory.Build.targets",
    "Directory.Packages.props",
)

PYTHON_MODULES = ("coverage", "pytest")

FIND_SPEC = (
    "import importlib.util as u;"
    "print(*[m for m in ('coverage','pytest') if u.find_spec(m) is None])"
)

GRADLE_FILE = re.compile(r"(\.gradle(\.kts)?|\.versions\.toml)$")

JACOCO_FIX = 'apply the jacoco plugin: id("jacoco")'

TEST_SCRIPT_FIX = "add a test script to package.json"

PROBE_SECONDS = 120


@dataclass(frozen=True)
class Probe:
    diagnosis: dict | None = None
    borrowed: dict[str, list[str]] = field(default_factory=dict)


def missing(line: str, fix: str) -> Probe:
    return Probe(diagnose("tool-missing", line, fix=fix))


def not_installed(tool: str, fix: str) -> Probe:
    return missing(f"{tool} is not installed; install it with {fix}", fix)


def answers(
    command: list[str], repository: Path, directory: str = ""
) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(
            command,
            cwd=repository / directory,
            env=tool_environment(repository, directory),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
            timeout=PROBE_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def missing_modules(python: list[str], repository: Path, directory: str = "") -> list[str] | None:
    result = answers([*python, "-c", FIND_SPEC], repository, directory)

    if result is None or result.returncode != 0:
        return None

    return [name for name in result.stdout.split() if name in PYTHON_MODULES]


def noun(names: list[str]) -> tuple[str, str]:
    if len(names) == 1:
        return f"{names[0]} is", "it"

    return f"{' and '.join(names)} are", "them"


def probe_python(repository: Path, directory: str = "") -> Probe:
    lock = python_lock(repository, directory)

    if lock == "uv.lock":
        if shutil.which("uv") is None:
            return not_installed("uv", "brew install uv")

        absent = missing_modules(["uv", "run", "python"], repository, directory)
        names = list(PYTHON_MODULES) if absent is None else absent

        return Probe(borrowed={directory: [word for name in names for word in ("--with", name)]})

    if lock == "poetry.lock":
        if shutil.which("poetry") is None:
            return not_installed("poetry", "brew install poetry")

        python, fix = ["poetry", "run", "python"], "poetry add --group dev"
    else:
        if shutil.which("python3") is None:
            return not_installed("python3", "brew install python")

        python, fix = ["python3"], "python3 -m pip install"

    absent = missing_modules(python, repository, directory)

    if not absent:
        return Probe()

    subject, pronoun = noun(absent)
    command = f"{fix} {' '.join(absent)}"

    return missing(f"{subject} not installed; install {pronoun} with {command}", command)


def installed_modules(repository: Path, directory: str) -> bool:
    return any(
        (repository / current / "node_modules").is_dir()
        or (repository / current / ".pnp.cjs").exists()
        for current in ancestors(directory)
    )


def probe_typescript(repository: Path, directory: str = "") -> Probe:
    for tool in ("npm", "npx"):
        if shutil.which(tool) is None:
            return not_installed(tool, "brew install node")

    try:
        package = json.loads((repository / directory / "package.json").read_text(encoding="utf-8"))
    except OSError:
        return missing("package.json is missing; " + TEST_SCRIPT_FIX, TEST_SCRIPT_FIX)
    except ValueError:
        return Probe()

    if not isinstance(package, dict):
        return Probe()

    scripts = package.get("scripts")

    if not isinstance(scripts, dict) or not scripts.get("test"):
        return missing("package.json has no test script; " + TEST_SCRIPT_FIX, TEST_SCRIPT_FIX)

    wanted = [
        key for key in ("dependencies", "devDependencies") if isinstance(package.get(key), dict)
    ]
    declared = any(package[key] for key in wanted)

    if declared and not installed_modules(repository, directory):
        return missing(
            "dependencies are not installed; install them with npm install", "npm install"
        )

    vitest = vitest_project(repository, directory)

    if vitest is not None and not vitest.has_coverage:
        return missing(
            "@vitest/coverage-v8 is not installed",
            f"npm install --save-dev @vitest/coverage-v8@{vitest.version}",
        )

    return Probe()


def names_jacoco(repository: Path, path: str) -> bool:
    try:
        return "jacoco" in (repository / path).read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return False


def probe_kotlin(repository: Path, directory: str = "") -> Probe:
    wrapper = repository / directory / "gradlew"

    if not (wrapper.is_file() and os.access(wrapper, os.X_OK)):
        return missing(
            "gradlew is missing or not executable; add the Gradle wrapper with gradle wrapper",
            "gradle wrapper",
        )

    if shutil.which("java") is None and not os.environ.get("JAVA_HOME"):
        return not_installed("java", "brew install openjdk")

    build_files = [
        path
        for path in listed_files(repository)
        if GRADLE_FILE.search(path) and (not directory or path.startswith(f"{directory}/"))
    ]

    if not any(names_jacoco(repository, path) for path in build_files):
        return missing(f"jacoco is not configured; {JACOCO_FIX}", JACOCO_FIX)

    return Probe()


def probe_rust(repository: Path, directory: str = "") -> Probe:
    if shutil.which("cargo") is None:
        return not_installed("cargo", "brew install rustup")

    result = answers(["cargo", "llvm-cov", "--version"], repository, directory)

    if result is None or result.returncode != 0:
        return not_installed("cargo-llvm-cov", "cargo install cargo-llvm-cov")

    return Probe()


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


def probe_csharp(repository: Path, scan: Scan) -> Probe:
    fix = "brew install --cask dotnet-sdk"

    if shutil.which("dotnet") is None:
        return not_installed("dotnet", fix)

    result = answers(["dotnet", "--version"], repository)

    if result is None or result.returncode != 0:
        return not_installed("dotnet", fix)

    for skipped in scan.skip_paths:
        directory = repository / skipped

        if directory.is_dir() and any(directory.glob("*.csproj")):
            if not project_has_coverlet(repository, directory):
                command = f"dotnet add {skipped} package {COVERLET}"

                return missing(
                    f"the csharp test project {skipped} does not reference {COVERLET}; "
                    f"add it with {command}",
                    command,
                )

    return Probe()


def probe_language(repository: Path, scan: Scan, directory: str = "") -> Probe:
    if scan.language == "python":
        return probe_python(repository, directory)

    if scan.language == "typescript":
        return probe_typescript(repository, directory)

    if scan.language == "kotlin":
        return probe_kotlin(repository, directory)

    if scan.language == "rust":
        return probe_rust(repository, directory)

    if scan.language == "csharp":
        return probe_csharp(repository, scan)

    return Probe()


def named_in(found: Probe, project: Project) -> Probe:
    if found.diagnosis is None or not project.directory:
        return found

    line = f"{project.directory}/: {found.diagnosis['line']}"

    return Probe({**found.diagnosis, "line": line}, found.borrowed)


def probe(repository: Path, scans: list[Scan], settings: dict) -> Probe:
    if settings.get("test_command") is not None or settings.get("coverage") is not None:
        return Probe()

    borrowed: dict[str, list[str]] = {}

    for scan in scans:
        projects = resolve(repository, scan)

        if scan.language == "csharp":
            projects = projects[:1]

        for project in projects:
            found = named_in(probe_language(repository, scan, project.directory), project)

            if found.diagnosis is not None:
                return found

            borrowed.update(found.borrowed)

    return Probe(borrowed=borrowed)
