import os
from pathlib import Path

SOURCE_EXTENSIONS = (".kt",)
SKIPPED_DIRECTORY_NAMES = ("build",)
SKIPPED_DIRECTORY_PREFIXES = (".",)
BUILD_FILES = ("build.gradle", "build.gradle.kts", "pom.xml")


def selection() -> dict:
    return {
        "extensions": list(SOURCE_EXTENSIONS),
        "skip_directory_names": list(SKIPPED_DIRECTORY_NAMES),
        "skip_directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
        "skip_directory_suffixes": [],
        "skip_directories_containing": [],
        "skip_file_globs": [],
    }


def is_skipped_directory(name: str) -> bool:
    return name.startswith(SKIPPED_DIRECTORY_PREFIXES) or name in SKIPPED_DIRECTORY_NAMES


def discover(root: Path) -> list[str]:
    found = []

    for current, directories, files in os.walk(root):
        current_path = Path(current)
        directories[:] = sorted(d for d in directories if not is_skipped_directory(d))

        for name in files:
            if name.endswith(SOURCE_EXTENSIONS):
                found.append((current_path / name).relative_to(root).as_posix())

    return sorted(found)


def directory_of(path: str) -> str:
    parent = Path(path).parent.as_posix()

    return "." if parent == "." else parent


def build_module_of(root: Path, directory: str) -> str:
    current = Path(directory)

    while True:
        if any((root / current / name).is_file() for name in BUILD_FILES):
            return current.as_posix()

        if current.as_posix() == ".":
            return "."

        current = current.parent
