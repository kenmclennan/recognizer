import os
from fnmatch import fnmatch
from pathlib import Path

SOURCE_EXTENSIONS = (".kt",)
SKIPPED_DIRECTORY_NAMES = ("build", "test", "androidTest", "integrationTest", "testFixtures")
SKIPPED_DIRECTORY_PREFIXES = (".",)
SKIPPED_DIRECTORY_SUFFIXES = ("Test",)
SKIPPED_FILE_PATTERNS = ("*Test.kt", "*Tests.kt")
BUILD_FILES = ("build.gradle", "build.gradle.kts", "pom.xml")


def selection() -> dict:
    return {
        "extensions": list(SOURCE_EXTENSIONS),
        "skip_directory_names": list(SKIPPED_DIRECTORY_NAMES),
        "skip_directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
        "skip_directory_suffixes": list(SKIPPED_DIRECTORY_SUFFIXES),
        "skip_directories_containing": [],
        "skip_file_globs": list(SKIPPED_FILE_PATTERNS),
    }


def is_skipped_directory(name: str) -> bool:
    return (
        name.startswith(SKIPPED_DIRECTORY_PREFIXES)
        or name in SKIPPED_DIRECTORY_NAMES
        or name.endswith(SKIPPED_DIRECTORY_SUFFIXES)
    )


def is_skipped_file(name: str) -> bool:
    return any(fnmatch(name, pattern) for pattern in SKIPPED_FILE_PATTERNS)


def discover(root: Path) -> list[str]:
    found = []

    for current, directories, files in os.walk(root):
        current_path = Path(current)
        directories[:] = sorted(d for d in directories if not is_skipped_directory(d))

        for name in files:
            if name.endswith(SOURCE_EXTENSIONS) and not is_skipped_file(name):
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
