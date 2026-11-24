import json
from pathlib import Path, PurePosixPath

from recognizer_scan_kotlin.gradle_build import (
    DEFAULT_JACOCO_REPORT,
    applies_jacoco,
    jacoco_report_of,
)


def escaped(text: str) -> str:
    return text.replace("{", "{{").replace("}", "}}")


def directory_of(path: str) -> str:
    return PurePosixPath(path).parent.as_posix()


def read_text(root: Path, path: str) -> str:
    try:
        return (root / path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def wrapper_for(directory: str, files: list[str]) -> str | None:
    wrappers = {directory_of(file) for file in files if PurePosixPath(file).name == "gradlew"}
    at = directory
    up = 0

    while True:
        if at in wrappers:
            return "./gradlew" if up == 0 else f"{'../' * up}gradlew"

        if at == ".":
            return None

        at = directory_of(at)
        up += 1


def inside_folder(file: str, directory: str) -> bool:
    return directory == "." or file.startswith(f"{directory}/")


def has_kotlin_sources(files: list[str], directory: str, nearer: list[str]) -> bool:
    base = "" if directory == "." else f"{directory}/"

    return any(
        file.endswith(".kt")
        and (file.startswith(f"{base}src/main/kotlin/") or file.startswith(f"{base}src/main/java/"))
        and not any(inside_folder(file, other) for other in nearer)
        for file in files
    )


def builds_of(files: list[str]) -> dict[str, str]:
    builds: dict[str, str] = {}

    for file in files:
        name = PurePosixPath(file).name

        if name in ("build.gradle.kts", "build.gradle") and "buildSrc" not in file.split("/"):
            directory = directory_of(file)

            if directory not in builds or name == "build.gradle.kts":
                builds[directory] = file

    return builds


def gradle_reading(
    root: Path, files: list[str], suites: list[dict]
) -> tuple[list[dict], list[dict]]:
    builds = builds_of(files)
    directories = list(builds)
    runners: list[dict] = []
    notes: list[dict] = []

    for directory, source in builds.items():
        if any(
            suite["directory"] == directory and suite["language"] == "kotlin" for suite in suites
        ):
            continue

        text = read_text(root, source)
        nearer = [
            other
            for other in directories
            if other != directory
            and other != "."
            and (directory == "." or other.startswith(f"{directory}/"))
        ]

        if not applies_jacoco(text):
            if has_kotlin_sources(files, directory, nearer):
                notes.append(
                    {
                        "language": "kotlin",
                        "directory": directory,
                        "text": (
                            f'no JaCoCo: add id("jacoco") to the plugins {{ }} block of '
                            f"{source} (Groovy: id 'jacoco'); Recognizer does not edit build files"
                        ),
                    }
                )

            continue

        wrapper = wrapper_for(directory, files)
        report = jacoco_report_of(text)

        if wrapper is None:
            notes.append(
                {
                    "language": "kotlin",
                    "directory": directory,
                    "text": (
                        "no Gradle wrapper (gradlew) found at or above this folder; "
                        "the command assumes one"
                    ),
                }
            )

        if report["kind"] == "unreadable":
            notes.append(
                {
                    "language": "kotlin",
                    "directory": directory,
                    "text": (
                        "the report path may differ: this build sets it in a form the survey "
                        f"cannot read; check {source} before running"
                    ),
                }
            )

        runners.append(
            {
                "language": "kotlin",
                "runner": "gradle",
                "directory": directory,
                "from": source,
                "command": escaped(f"{wrapper or './gradlew'} cleanTest test jacocoTestReport"),
                "coverage": {
                    "path": escaped(
                        report["path"] if report["kind"] == "literal" else DEFAULT_JACOCO_REPORT
                    ),
                    "format": "jacoco",
                },
                "tool": None,
            }
        )

    runners.sort(key=lambda one: one["directory"])
    notes.sort(key=lambda note: (note["directory"], note["text"]))

    return runners, notes


def survey(request: dict) -> dict:
    runners, notes = gradle_reading(Path(request["root"]), request["files"], request["suites"])

    return {"runners": runners, "tools": [], "notes": notes}


def survey_file(path: str) -> str:
    request = json.loads(Path(path).read_text(encoding="utf-8"))

    return json.dumps(survey(request), indent=2) + "\n"
