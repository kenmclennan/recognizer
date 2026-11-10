import re
import shlex
import shutil
from pathlib import Path

from recognizer_sensors.scans import Scan
from recognizer_sensors.testrun.probes import (
    PREFLIGHT_SECONDS,
    ProbeTimedOut,
    environment_absent,
    probe_language,
)
from recognizer_sensors.testrun.profiles import UV_ENVIRONMENT, UV_ENVIRONMENTS, python_lock
from recognizer_sensors.testrun.projects import resolve, slugify

REPOSITORY_FIXES = ("npm install", "poetry add", "dotnet add", "uv sync")

MANUAL_FIXES = ("apply ", "add a test script")


def kebab(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def fix_of(text: str, directory: str) -> dict:
    manual = text.startswith(MANUAL_FIXES)
    repository = text.startswith(REPOSITORY_FIXES)

    return {
        "text": text,
        "command": None if manual else shlex.split(text),
        "cwd": "" if text.startswith("dotnet add") or not repository else directory,
        "env": {},
        "kind": "repository" if repository else "outside",
    }


def gap_of(
    sensor: str, scan: Scan, directory: str, cause: str, line: str, fix: dict, needs: list[str]
) -> dict:
    return {
        "id": f"{sensor}:{scan.language}:{slugify(directory) or 'root'}:{cause}",
        "line": line,
        "needs": needs,
        "project": {"language": scan.language, "directory": directory},
        "fix": fix,
    }


def phrase(line: str) -> str:
    return line.split("; ", 1)[0]


def environment_gap(sensor: str, scan: Scan, directory: str, slug: str) -> dict:
    folder = UV_ENVIRONMENT if not directory else f"{UV_ENVIRONMENTS}/{slug}"
    fix = {
        "text": "uv sync",
        "command": ["uv", "sync"],
        "cwd": directory,
        "env": {"UV_PROJECT_ENVIRONMENT": folder},
        "kind": "repository",
    }

    return gap_of(
        sensor,
        scan,
        directory,
        "environment",
        "the project's environment is not set up",
        fix,
        [sensor],
    )


def timeout_gap(sensor: str, scan: Scan, directory: str, error: ProbeTimedOut) -> dict:
    command = " ".join(error.command)
    fix = {
        "text": f"run {command} by hand to see why it is slow",
        "command": None,
        "cwd": directory,
        "env": {},
        "kind": "outside",
    }

    return gap_of(
        sensor,
        scan,
        directory,
        "timeout",
        f"did not answer within {error.seconds} seconds",
        fix,
        [sensor],
    )


def project_gaps(repository: Path, scan: Scan, project, sensor: str) -> list[dict]:
    directory = project.directory

    try:
        found = probe_language(repository, scan, directory, PREFLIGHT_SECONDS)

        if found.diagnosis is not None:
            line = phrase(found.diagnosis["line"])
            fix = fix_of(found.diagnosis.get("fix") or "", directory)

            return [gap_of(sensor, scan, directory, kebab(line), line, fix, [sensor])]

        if (
            scan.language == "python"
            and python_lock(repository, directory) == "uv.lock"
            and shutil.which("uv") is not None
            and environment_absent(repository, directory, PREFLIGHT_SECONDS)
        ):
            return [environment_gap(sensor, scan, directory, project.slug)]
    except ProbeTimedOut as error:
        return [timeout_gap(sensor, scan, directory, error)]

    return []


def gaps(repository: Path, scans: list[Scan], settings: dict, sensor: str) -> list[dict]:
    if settings.get("test_command") is not None or settings.get("coverage") is not None:
        return []

    found: list[dict] = []

    for scan in scans:
        projects = resolve(repository, scan)

        if scan.language == "csharp":
            projects = projects[:1]

        for project in projects:
            found.extend(project_gaps(repository, scan, project, sensor))

    return found
