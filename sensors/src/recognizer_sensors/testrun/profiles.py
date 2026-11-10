import json
import os
import shlex
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.testrun.gradle import WRAPPER, gradle_environment, is_gradle
from recognizer_sensors.testrun.kotlin_store import prepare_listener
from recognizer_sensors.testrun.projects import Project, ancestors, slugify

PLUGIN_DIRECTORY = Path(__file__).parent / "plugin"

UV_ENVIRONMENT = ".recognizer/cache/python-env"

UV_ENVIRONMENTS = ".recognizer/cache/python-envs"

COVERAGE_ROOT = ".recognizer/cache/coverage"

PYTHON_DATA = ".recognizer/cache/coverage/python.data"

LEGACY_CONTEXTS_PATH = ".recognizer/cache/coverage/python.contexts.json"

MAX_SELECTED_FILES = 50

KOTLIN_CLASSES: dict[str, list[tuple[str, str]]] = {}

CSHARP_CLASSES: dict[str, list[str]] = {}

RUST_UNITS: dict[str, tuple[str, str, str]] = {}

PYTHON_BORROWED: dict[str, list[str]] = {}

CSHARP_TRX_LOGGER = ["--logger", "trx;LogFilePrefix=results"]

PYTHON_COVERAGE = (
    "export COVERAGE_FILE=.recognizer/cache/coverage/python.data"
    "; {runner} coverage run -m pytest; status=$?"
    "; {runner} coverage lcov -o .recognizer/cache/coverage/python.lcov; lcov=$?"
    "; [ $status -ne 0 ] && exit $status; exit $lcov"
)

PYTHON_COVERAGE_CONTEXTS = (
    "export COVERAGE_FILE=.recognizer/cache/coverage/python.data"
    " && export PYTHONPATH={plugin}${{PYTHONPATH:+:$PYTHONPATH}}"
    "; {{runner}} coverage run -m pytest -p recognizer_covctx; status=$?"
    "; {{runner}} coverage lcov -o .recognizer/cache/coverage/python.lcov; lcov=$?"
    "; [ $status -ne 0 ] && exit $status; exit $lcov"
)

PYTHON_RUNNERS = (
    ("uv.lock", ["uv", "run"]),
    ("poetry.lock", ["poetry", "run"]),
    (None, ["python3", "-m"]),
)

PROFILES = {
    "python": {
        "runners": [
            {"lockfile": lockfile, "command": command} for lockfile, command in PYTHON_RUNNERS
        ],
        "coverage_command": ["sh", "-c", PYTHON_COVERAGE],
        "report": ".recognizer/cache/coverage/python.lcov",
        "format": "lcov",
        "test_command": ["{runner}", "pytest", "-rfE"],
    },
    "typescript": {
        "coverage_command": [
            "npx",
            "--yes",
            "c8",
            "--reporter=lcovonly",
            "--reports-dir",
            ".recognizer/cache/coverage/typescript",
            "npm",
            "test",
        ],
        "report": ".recognizer/cache/coverage/typescript/lcov.info",
        "format": "lcov",
        "test_command": ["npm", "test"],
    },
    "kotlin": {
        "coverage_command": ["./gradlew", "test", "jacocoTestReport"],
        "report": "**/build/reports/jacoco/test/jacocoTestReport.xml",
        "format": "jacoco",
        "test_command": ["./gradlew", "test"],
    },
    "rust": {
        "coverage_command": [
            "cargo",
            "llvm-cov",
            "--lcov",
            "--output-path",
            ".recognizer/cache/coverage/rust.lcov",
            "--ignore-run-fail",
        ],
        "report": ".recognizer/cache/coverage/rust.lcov",
        "format": "lcov",
        "test_command": ["cargo", "test"],
    },
    "csharp": {
        "coverage_command": [
            "dotnet",
            "test",
            "--collect:XPlat Code Coverage;Format=lcov",
            "--results-directory",
            ".recognizer/cache/coverage/csharp",
        ],
        "report": ".recognizer/cache/coverage/csharp/*/coverage.info",
        "format": "lcov",
        "test_command": ["dotnet", "test"],
    },
}


def python_lock(repository: Path, directory: str = "") -> str | None:
    for current in ancestors(directory):
        for lockfile, _ in PYTHON_RUNNERS:
            if lockfile is not None and (repository / current / lockfile).is_file():
                return lockfile

    return None


def python_runner(repository: Path, directory: str = "") -> list[str]:
    lock = python_lock(repository, directory)

    for lockfile, command in PYTHON_RUNNERS:
        if lockfile == lock:
            runner = list(command)

            return [*runner, *PYTHON_BORROWED.get(directory, [])] if runner[0] == "uv" else runner

    return list(PYTHON_RUNNERS[-1][1])


def isolated(runner: list[str]) -> list[str]:
    if runner[0] != "uv":
        return runner

    return [*runner, "env", "-u", "UV_PROJECT_ENVIRONMENT"]


def coverage_runner(runner: list[str], interpreter: Path) -> list[str]:
    if runner[0] != "uv":
        return runner

    wrapper = shlex.quote(str(PLUGIN_DIRECTORY / "borrowed_python.py"))

    return [*isolated(runner), "python", wrapper, shlex.quote(str(interpreter)), "-m"]


def environment_folder(repository: Path, directory: str, slug: str | None) -> Path:
    if not directory:
        return repository / UV_ENVIRONMENT

    return repository / UV_ENVIRONMENTS / (slugify(directory) if slug is None else slug)


USER_COMMANDS: set[tuple[str, ...]] = set()


def tool_environment(
    repository: Path,
    directory: str = "",
    slug: str | None = None,
    command: list[str] | None = None,
) -> dict[str, str] | None:
    base = python_environment(repository, directory, slug)

    if command is not None and is_gradle(command) and tuple(command) not in USER_COMMANDS:
        return gradle_environment(repository, base)

    return base


def python_environment(repository: Path, directory: str, slug: str | None) -> dict[str, str] | None:
    if python_lock(repository, directory) != "uv.lock":
        return None

    environment = environment_folder(repository, directory, slug)

    environment.mkdir(parents=True, exist_ok=True)

    return {**os.environ, "UV_PROJECT_ENVIRONMENT": str(environment)}


def coverage_directory(repository: Path, project: Project | None) -> str:
    if project is None or not project.directory:
        return COVERAGE_ROOT

    return str(repository / COVERAGE_ROOT / "projects" / project.slug)


def report_path(language: str, project: Project | None = None) -> str:
    report = PROFILES[language]["report"]

    if project is None or not project.directory:
        return report

    if language == "kotlin":
        return f"{project.directory}/{report}"

    return report.replace(COVERAGE_ROOT, f"{COVERAGE_ROOT}/projects/{project.slug}", 1)


def python_data_path(project: Project | None = None) -> str:
    if project is None or not project.directory:
        return PYTHON_DATA

    return PYTHON_DATA.replace(COVERAGE_ROOT, f"{COVERAGE_ROOT}/projects/{project.slug}", 1)


def with_cache(command: list[str], cache: str) -> list[str]:
    if cache == COVERAGE_ROOT:
        return list(command)

    quoted = shlex.quote(cache) if command[:2] == ["sh", "-c"] else cache

    return [word.replace(COVERAGE_ROOT, quoted) for word in command]


def fill(command: list[str], runner: list[str] | None, joined: bool) -> list[str]:
    if runner is None:
        return list(command)

    if joined:
        return [word.replace("{runner}", " ".join(runner)) for word in command]

    filled: list[str] = []

    for word in command:
        filled.extend(runner if word == "{runner}" else [word])

    return filled


def coverage_command(
    repository: Path, language: str, contexts: bool = False, project: Project | None = None
) -> list[str]:
    directory = project.directory if project is not None else ""
    runner = (
        coverage_runner(
            python_runner(repository, directory),
            environment_folder(repository, directory, project.slug if project else None)
            / "bin"
            / "python",
        )
        if language == "python"
        else None
    )
    command = PROFILES[language]["coverage_command"]

    if language == "typescript" and vitest_project(repository, directory) is not None:
        command = vitest_command(COVERAGE_ROOT + "/typescript", [])

    if contexts and language == "python":
        script = PYTHON_COVERAGE_CONTEXTS.format(plugin=shlex.quote(str(PLUGIN_DIRECTORY)))
        command = ["sh", "-c", script]

    if contexts and language == "kotlin":
        arguments = prepare_listener(repository)

        if arguments:
            return [WRAPPER, *arguments, "test", "--rerun", "jacocoTestReport"]

    if contexts and language == "csharp":
        command = [*command, *CSHARP_TRX_LOGGER]

    return fill(with_cache(command, coverage_directory(repository, project)), runner, joined=True)


@dataclass(frozen=True)
class VitestProject:
    version: str
    has_coverage: bool


def typescript_runner(repository: Path) -> str | None:
    try:
        script = json.loads((repository / "package.json").read_text())["scripts"]["test"]
        words = shlex.split(script)
    except (OSError, ValueError, KeyError, TypeError):
        return None

    return words[0] if words and words[0] in ("jest", "vitest") else None


def installed_version(package: Path) -> str | None:
    try:
        version = json.loads(package.read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError, AttributeError):
        return None

    return version if isinstance(version, str) else None


def vitest_project(repository: Path, directory: str) -> VitestProject | None:
    if typescript_runner(repository / directory) != "vitest":
        return None

    folders = [repository / current / "node_modules" for current in ancestors(directory)]
    versions = [v for v in (installed_version(f / "vitest" / "package.json") for f in folders) if v]

    if not versions:
        return None

    return VitestProject(
        versions[0],
        any((f / "@vitest" / "coverage-v8" / "package.json").is_file() for f in folders),
    )


def vitest_command(reports: str, files: list[str]) -> list[str]:
    return [
        "npm",
        "test",
        "--",
        "--coverage.enabled",
        "--coverage.provider=v8",
        "--coverage.reporter=lcovonly",
        f"--coverage.reportsDirectory={reports}",
        *files,
    ]


def by_file_command(repository: Path, file: str, number: int) -> list[str]:
    if vitest_project(repository, "") is not None:
        return vitest_command(f".recognizer/cache/coverage/typescript/by-file/{number}", [file])

    command = list(PROFILES["typescript"]["coverage_command"])
    command[command.index("--reports-dir") + 1] = (
        f".recognizer/cache/coverage/typescript/by-file/{number}"
    )

    return [*command, "--", file]


def kotlin_by_file_command(project: str, classes: list[str]) -> list[str]:
    return [
        "./gradlew",
        f"{project}:test" if project else "test",
        "--rerun",
        *[arg for name in classes for arg in ("--tests", name)],
        f"{project}:jacocoTestReport" if project else "jacocoTestReport",
    ]


def kotlin_selected_command(selected: list[tuple[str, str]]) -> list[str]:
    command = ["./gradlew"]

    for project in sorted({project for project, _ in selected}):
        command.append(f"{project}:test" if project else "test")

        for name in sorted(name for p, name in selected if p == project):
            command += ["--tests", name]

    return command


def csharp_filter(classes: list[str]) -> str:
    return "|".join(f"FullyQualifiedName~{name}." for name in sorted(classes))


def csharp_by_file_command(number: int, classes: list[str]) -> list[str]:
    return [
        "dotnet",
        "test",
        "--collect:XPlat Code Coverage;Format=lcov",
        "--results-directory",
        f".recognizer/cache/coverage/csharp/by-file/{number}",
        "--logger",
        "trx;LogFilePrefix=results",
        "--filter",
        csharp_filter(classes),
    ]


def csharp_selected_command(classes: list[str]) -> list[str]:
    return ["dotnet", "test", "--filter", csharp_filter(classes)]


def rust_by_target_command(number: int, unit: tuple[str, str, str]) -> list[str]:
    package, kind, name = unit
    flag = ["--lib"] if kind == "lib" else [f"--{kind}", name]

    return [
        "cargo",
        "llvm-cov",
        "--lcov",
        "--output-path",
        f".recognizer/cache/coverage/rust/by-target/{number}.lcov",
        "-p",
        package,
        *flag,
    ]


def rust_selected_command(units: list[tuple[str, str, str]]) -> list[str]:
    command = ["cargo", "test"]

    for package in sorted({package for package, _, _ in units}):
        command += ["-p", package]

    if any(kind == "lib" for _, kind, _ in units):
        command.append("--lib")

    for kind in ("bin", "test"):
        for name in sorted({name for _, k, name in units if k == kind}):
            command += [f"--{kind}", name]

    return command


def typescript_flags(repository: Path, stop: bool, workers: int) -> list[str]:
    if typescript_runner(repository) is None:
        return []

    cap = [f"--maxWorkers={max(1, (os.cpu_count() or 1) // workers)}"] if workers > 1 else []

    return [*(["--bail=1"] if stop else []), *cap]


def kotlin_fail_fast(command: list[str]) -> list[str]:
    stopped: list[str] = []

    for word in command:
        stopped.append(word)

        if word == "test" or word.endswith(":test"):
            stopped.append("--fail-fast")

    return stopped


def mutant_command(
    repository: Path, language: str, stop: bool = False, workers: int = 1, directory: str = ""
) -> list[str]:
    runner = isolated(python_runner(repository, directory)) if language == "python" else None
    command = fill(PROFILES[language]["test_command"], runner, joined=False)

    if language == "typescript":
        flags = typescript_flags(repository / directory, stop, workers)

        return [*command, "--", *flags] if flags else command

    if not stop:
        return command

    if language == "python":
        return [*command, "-x"]

    if language == "kotlin":
        return kotlin_fail_fast(command)

    return command


def killers_first(files: set[str] | frozenset[str], previous: frozenset[str]) -> list[str]:
    return sorted(files, key=lambda f: (f not in previous, f))


def relative_to_directory(files: set[str] | frozenset[str], directory: str) -> list[str] | None:
    if not directory:
        return list(files)

    found = [f.removeprefix(f"{directory}/") for f in files if f.startswith(f"{directory}/")]

    return found if len(found) == len(files) else None


def selected_command(
    repository: Path,
    language: str,
    files: set[str] | frozenset[str],
    stop: bool = False,
    previous: frozenset[str] = frozenset(),
    workers: int = 1,
    directory: str = "",
):
    if language == "python":
        prefix = [
            *isolated(python_runner(repository, directory)),
            "pytest",
            "-rfE",
            *(["-x"] if stop else []),
        ]
    elif language == "typescript":
        prefix = ["npm", "test", "--", *typescript_flags(repository / directory, stop, workers)]
    elif language == "kotlin":
        return kotlin_command_for(repository, files, stop, directory)
    elif language == "csharp":
        return csharp_command_for(repository, files, directory)
    elif language == "rust":
        return rust_command_for(repository, files, directory)
    else:
        return None

    local = relative_to_directory(files, directory)

    if (
        not files
        or local is None
        or len(files) > MAX_SELECTED_FILES
        or any(f.startswith("-") for f in local)
    ):
        return mutant_command(repository, language, stop, workers, directory)

    kept = frozenset(relative_to_directory(previous, directory) or ()) if directory else previous

    ordered = killers_first(set(local), kept)

    return [*prefix, *ordered]


def kotlin_command_for(
    repository: Path, files: set[str] | frozenset[str], stop: bool = False, directory: str = ""
) -> list[str]:
    if not files or len(files) > MAX_SELECTED_FILES or any(f.startswith("-") for f in files):
        return mutant_command(repository, "kotlin", stop, directory=directory)

    if any(f not in KOTLIN_CLASSES for f in files):
        return mutant_command(repository, "kotlin", stop, directory=directory)

    command = kotlin_selected_command([pair for f in sorted(files) for pair in KOTLIN_CLASSES[f]])

    return kotlin_fail_fast(command) if stop else command


def csharp_command_for(
    repository: Path, files: set[str] | frozenset[str], directory: str = ""
) -> list[str]:
    if not files or len(files) > MAX_SELECTED_FILES or any(f.startswith("-") for f in files):
        return mutant_command(repository, "csharp", directory=directory)

    if any(f not in CSHARP_CLASSES for f in files):
        return mutant_command(repository, "csharp", directory=directory)

    return csharp_selected_command([name for f in sorted(files) for name in CSHARP_CLASSES[f]])


def rust_command_for(
    repository: Path, files: set[str] | frozenset[str], directory: str = ""
) -> list[str]:
    if not files or len(files) > MAX_SELECTED_FILES or any(f.startswith("-") for f in files):
        return mutant_command(repository, "rust", directory=directory)

    if any(f not in RUST_UNITS for f in files):
        return mutant_command(repository, "rust", directory=directory)

    return rust_selected_command([RUST_UNITS[f] for f in sorted(files)])
