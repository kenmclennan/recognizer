from pathlib import Path

PYTHON_COVERAGE = (
    "export COVERAGE_FILE=.recognizer/cache/coverage/python.data"
    " && {runner} coverage run -m pytest"
    " && {runner} coverage lcov -o .recognizer/cache/coverage/python.lcov"
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
        "test_command": ["{runner}", "pytest"],
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
        ],
        "report": ".recognizer/cache/coverage/rust.lcov",
        "format": "lcov",
        "test_command": ["cargo", "test"],
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


def coverage_command(repository: Path, language: str) -> list[str]:
    runner = python_runner(repository) if language == "python" else None

    return fill(PROFILES[language]["coverage_command"], runner, joined=True)


def mutant_command(repository: Path, language: str) -> list[str]:
    runner = python_runner(repository) if language == "python" else None

    return fill(PROFILES[language]["test_command"], runner, joined=False)
