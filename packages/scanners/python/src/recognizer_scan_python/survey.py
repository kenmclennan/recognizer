import json
import re
import subprocess
from collections.abc import Callable
from pathlib import Path, PurePosixPath

REPORT_ROOT = "{up}.recognizer/cache/coverage/{slug}"
CACHE_ENVIRONMENT = "{up}.recognizer/cache/python/{slug}"
CACHE_FOLDER = ".recognizer/cache/python"
REQUIREMENTS = re.compile(r"^requirements.*\.txt$")
PYTEST = re.compile(r"\bpytest\b")

Probe = Callable[[str], bool]


def escaped(text: str) -> str:
    return text.replace("{", "{{").replace("}", "}}")


def directory_of(path: str) -> str:
    return PurePosixPath(path).parent.as_posix()


def read_text(root: Path, path: str) -> str:
    try:
        return (root / path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def command_probe(root: Path) -> Probe:
    def probe(command: str) -> bool:
        try:
            result = subprocess.run(
                [command, "--version"],
                cwd=root,
                capture_output=True,
                check=False,
            )
        except OSError:
            return False

        return result.returncode == 0

    return probe


def project_environment(root: Path, directory: str) -> str | None:
    candidates = [
        (root / directory / ".venv", ".venv"),
        (root / directory / "venv", "venv"),
    ]

    if directory != ".":
        up = "../" * len(directory.split("/"))

        candidates.append((root / ".venv", f"{up}.venv"))
        candidates.append((root / "venv", f"{up}venv"))

    for path, relative in candidates:
        if (path / "bin" / "python").exists():
            return relative

    return None


def python_runners(root: Path, files: list[str], probe: Probe) -> tuple[list[dict], list[dict]]:
    manifests = [
        file
        for file in files
        if PurePosixPath(file).name == "pyproject.toml"
        or REQUIREMENTS.match(PurePosixPath(file).name)
    ]
    by_directory: dict[str, str] = {}

    for file in manifests:
        if PYTEST.search(read_text(root, file)):
            directory = directory_of(file)

            if directory not in by_directory or PurePosixPath(file).name == "pyproject.toml":
                by_directory[directory] = file

    if not by_directory:
        return [], []

    uv = probe("uv")
    python3: bool | None = None
    found: list[dict] = []
    notes: list[dict] = []

    for directory, source in by_directory.items():
        project = project_environment(root, directory)

        if project is None and not uv:
            if python3 is None:
                python3 = probe("python3")

            if not python3:
                notes.append(
                    {
                        "language": "python",
                        "directory": directory,
                        "text": (
                            "no Python environment: this folder has no .venv or venv, and "
                            "neither uv nor python3 is on the PATH; install uv "
                            "(brew install uv) and run setup again"
                        ),
                    }
                )

                continue

        found.append({"directory": directory, "from": source, "project": project})

    found.sort(key=lambda one: one["directory"])

    return found, notes


def environment_of(one: dict) -> str:
    return one["project"] if one["project"] is not None else CACHE_ENVIRONMENT


def runner_of(one: dict) -> dict:
    return {
        "language": "python",
        "runner": "pytest",
        "directory": one["directory"],
        "from": one["from"],
        "command": f"pytest --cov --cov-report=lcov:{REPORT_ROOT}/lcov.info",
        "coverage": {
            "path": ".recognizer/cache/coverage/{slug}/lcov.info",
            "format": "lcov",
        },
        "tool": "pytest-cov",
        "activate": f"source {environment_of(one)}/bin/activate",
    }


def tool_of(root: Path, files: list[str], one: dict, uv: bool) -> dict:
    environment = environment_of(one)
    own = one["project"] is None
    in_directory = [file for file in files if directory_of(file) == one["directory"]]
    requirements = sorted(
        PurePosixPath(file).name
        for file in in_directory
        if REQUIREMENTS.match(PurePosixPath(file).name) and PYTEST.search(read_text(root, file))
    )
    declared = any(
        "pytest-cov" in read_text(root, file)
        for file in in_directory
        if PurePosixPath(file).name == "pyproject.toml"
        or REQUIREMENTS.match(PurePosixPath(file).name)
    )
    python3_path = f"{environment}/bin/python"
    base = {
        "name": "pytest-cov",
        "kind": "pip",
        "why": "pytest writes its coverage report through this plugin",
        "needed_by": [one["from"]],
        "cwd": one["directory"],
    }

    if not own:
        return {
            **base,
            "installed": declared,
            "installs": f"the project environment at {environment}",
            "command": (
                ["uv", "pip", "install", "--python", python3_path, "pytest-cov"]
                if uv
                else [python3_path, "-m", "pip", "install", "pytest-cov"]
            ),
        }

    wanted = [word for file in requirements for word in ("-r", escaped(file))]

    return {
        **base,
        "installed": False,
        "installs": f"a new environment at {CACHE_FOLDER}/{{slug}}",
        "prepare": [["uv", "venv", environment] if uv else ["python3", "-m", "venv", environment]],
        "command": (
            ["uv", "pip", "install", "--python", python3_path, *wanted, "pytest-cov"]
            if uv
            else [python3_path, "-m", "pip", "install", *wanted, "pytest-cov"]
        ),
    }


def dependency_notes(root: Path, files: list[str], found: list[dict]) -> list[dict]:
    return [
        {
            "language": "python",
            "directory": one["directory"],
            "text": (
                "the project's own dependencies are not installed in the new environment: "
                "this folder declares them in pyproject.toml; create a .venv with them and "
                "run setup again to use it"
            ),
        }
        for one in found
        if one["project"] is None
        and not any(
            directory_of(file) == one["directory"]
            and REQUIREMENTS.match(PurePosixPath(file).name)
            and PYTEST.search(read_text(root, file))
            for file in files
        )
    ]


def survey(request: dict, probe: Probe | None = None) -> dict:
    root = Path(request["root"])
    files: list[str] = request["files"]
    suites = request["suites"]
    ask = probe if probe is not None else command_probe(root)
    found, notes = python_runners(root, files, ask)
    remaining = [
        one
        for one in found
        if not any(
            suite["directory"] == one["directory"] and suite["language"] == "python"
            for suite in suites
        )
    ]
    uv = ask("uv") if remaining else False

    return {
        "runners": [runner_of(one) for one in remaining],
        "tools": [tool_of(root, files, one, uv) for one in remaining],
        "notes": [*notes, *dependency_notes(root, files, remaining)],
    }


def survey_file(path: str) -> str:
    request = json.loads(Path(path).read_text(encoding="utf-8"))

    return json.dumps(survey(request), indent=2) + "\n"
