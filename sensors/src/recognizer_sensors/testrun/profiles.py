import shlex
from pathlib import Path

PLUGIN_DIRECTORY = Path(__file__).parent / "plugin"

CONTEXTS_JSON = ".recognizer/cache/coverage/python.contexts.json"

MAX_SELECTED_FILES = 50

KOTLIN_CLASSES: dict[str, list[tuple[str, str]]] = {}

CSHARP_CLASSES: dict[str, list[str]] = {}

RUST_UNITS: dict[str, tuple[str, str, str]] = {}

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
    "; {{runner}} coverage json --show-contexts -o " + CONTEXTS_JSON + "; json=$?"
    "; [ $status -ne 0 ] && exit $status; [ $lcov -ne 0 ] && exit $lcov; exit $json"
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


def python_runner(repository: Path) -> list[str]:
    for entry in PROFILES["python"]["runners"]:
        lockfile = entry["lockfile"]

        if lockfile is None or (repository / lockfile).is_file():
            return list(entry["command"])

    return list(PYTHON_RUNNERS[-1][1])


def fill(command: list[str], runner: list[str] | None, joined: bool) -> list[str]:
    if runner is None:
        return list(command)

    if joined:
        return [word.replace("{runner}", " ".join(runner)) for word in command]

    filled: list[str] = []

    for word in command:
        filled.extend(runner if word == "{runner}" else [word])

    return filled


def coverage_command(repository: Path, language: str, contexts: bool = False) -> list[str]:
    runner = python_runner(repository) if language == "python" else None
    command = PROFILES[language]["coverage_command"]

    if contexts and language == "python":
        script = PYTHON_COVERAGE_CONTEXTS.format(plugin=shlex.quote(str(PLUGIN_DIRECTORY)))
        command = ["sh", "-c", script]

    if contexts and language == "csharp":
        command = [*command, *CSHARP_TRX_LOGGER]

    return fill(command, runner, joined=True)


def by_file_command(file: str, number: int) -> list[str]:
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


def mutant_command(repository: Path, language: str) -> list[str]:
    runner = python_runner(repository) if language == "python" else None

    return fill(PROFILES[language]["test_command"], runner, joined=False)


def selected_command(repository: Path, language: str, files: set[str] | frozenset[str]):
    if language == "python":
        prefix = [*python_runner(repository), "pytest", "-rfE"]
    elif language == "typescript":
        prefix = ["npm", "test", "--"]
    elif language == "kotlin":
        return kotlin_command_for(repository, files)
    elif language == "csharp":
        return csharp_command_for(repository, files)
    elif language == "rust":
        return rust_command_for(repository, files)
    else:
        return None

    if not files or len(files) > MAX_SELECTED_FILES or any(f.startswith("-") for f in files):
        return mutant_command(repository, language)

    return [*prefix, *sorted(files)]


def kotlin_command_for(repository: Path, files: set[str] | frozenset[str]) -> list[str]:
    if not files or len(files) > MAX_SELECTED_FILES or any(f.startswith("-") for f in files):
        return mutant_command(repository, "kotlin")

    if any(f not in KOTLIN_CLASSES for f in files):
        return mutant_command(repository, "kotlin")

    return kotlin_selected_command([pair for f in sorted(files) for pair in KOTLIN_CLASSES[f]])


def csharp_command_for(repository: Path, files: set[str] | frozenset[str]) -> list[str]:
    if not files or len(files) > MAX_SELECTED_FILES or any(f.startswith("-") for f in files):
        return mutant_command(repository, "csharp")

    if any(f not in CSHARP_CLASSES for f in files):
        return mutant_command(repository, "csharp")

    return csharp_selected_command([name for f in sorted(files) for name in CSHARP_CLASSES[f]])


def rust_command_for(repository: Path, files: set[str] | frozenset[str]) -> list[str]:
    if not files or len(files) > MAX_SELECTED_FILES or any(f.startswith("-") for f in files):
        return mutant_command(repository, "rust")

    if any(f not in RUST_UNITS for f in files):
        return mutant_command(repository, "rust")

    return rust_selected_command([RUST_UNITS[f] for f in sorted(files)])
