import os
from fnmatch import fnmatch
from pathlib import Path

TEST_DIRECTORY_NAMES = ("test", "tests")
TEST_FILE_PATTERNS = ("conftest.py",)
SKIPPED_DIRECTORY_NAMES = (
    "__pycache__",
    "test",
    "tests",
    "dist",
    "build",
    "node_modules",
    "site-packages",
)
SKIPPED_FILE_PATTERNS = ("conftest.py",)
SOURCE_EXTENSIONS = (".py",)
SKIPPED_DIRECTORY_PREFIXES = (".",)
SKIPPED_DIRECTORY_SUFFIXES = (".egg-info",)
SKIPPED_DIRECTORY_MARKERS = ("pyvenv.cfg",)


def selection() -> dict:
    return {
        "extensions": list(SOURCE_EXTENSIONS),
        "skip_directory_names": list(SKIPPED_DIRECTORY_NAMES),
        "skip_directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
        "skip_directory_suffixes": list(SKIPPED_DIRECTORY_SUFFIXES),
        "skip_directories_containing": list(SKIPPED_DIRECTORY_MARKERS),
        "skip_file_globs": list(SKIPPED_FILE_PATTERNS),
    }


def is_skipped_directory(path: Path) -> bool:
    return path.name in SKIPPED_DIRECTORY_NAMES or is_unreadable_directory(path)


def is_unreadable_directory(path: Path) -> bool:
    name = path.name
    return (
        name.startswith(SKIPPED_DIRECTORY_PREFIXES)
        or (name in SKIPPED_DIRECTORY_NAMES and name not in TEST_DIRECTORY_NAMES)
        or name.endswith(SKIPPED_DIRECTORY_SUFFIXES)
        or any((path / marker).exists() for marker in SKIPPED_DIRECTORY_MARKERS)
    )


def is_skipped_file(name: str) -> bool:
    return any(fnmatch(name, pattern) for pattern in SKIPPED_FILE_PATTERNS)


def discover(root: Path) -> list[str]:
    found = []

    for current, directories, files in os.walk(root):
        current_path = Path(current)
        directories[:] = sorted(
            d for d in directories if not is_skipped_directory(current_path / d)
        )

        for name in files:
            if name.endswith(SOURCE_EXTENSIONS) and not is_skipped_file(name):
                found.append((current_path / name).relative_to(root).as_posix())

    return sorted(found)


def discover_tests(root: Path) -> list[str]:
    found = []

    for current, directories, files in os.walk(root):
        current_path = Path(current)
        directories[:] = sorted(
            d for d in directories if not is_unreadable_directory(current_path / d)
        )
        inside_tests = any(
            part in TEST_DIRECTORY_NAMES for part in current_path.relative_to(root).parts
        )

        for name in files:
            if not name.endswith(SOURCE_EXTENSIONS):
                continue

            if inside_tests or any(fnmatch(name, pattern) for pattern in TEST_FILE_PATTERNS):
                found.append((current_path / name).relative_to(root).as_posix())

    return sorted(found)
