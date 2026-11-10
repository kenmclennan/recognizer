import os
import subprocess
import sys
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


Listing = frozenset[str] | None


class _Unread:
    pass


UNREAD = _Unread()


def git_listing(root: Path) -> Listing:
    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ],
            capture_output=True,
            check=False,
        )
    except OSError:
        return None

    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()

        if "not a git repository" not in message:
            first = message.splitlines()[0] if message else "exit " + str(result.returncode)
            print(
                f"recognizer-scan-python: git could not list files ({first}); scanning every file",
                file=sys.stderr,
            )

        return None

    return frozenset(
        entry.decode("utf-8", errors="surrogateescape")
        for entry in result.stdout.split(b"\0")
        if entry
    )


def resolve_listing(root: Path, listing: "Listing | _Unread") -> Listing:
    return git_listing(root) if isinstance(listing, _Unread) else listing


def is_listed(listing: Listing, relative: str) -> bool:
    return listing is None or relative in listing


def selection(absent_paths: list[str] | None = None) -> dict:
    found = {
        "extensions": list(SOURCE_EXTENSIONS),
        "skip_directory_names": list(SKIPPED_DIRECTORY_NAMES),
        "skip_directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
        "skip_directory_suffixes": list(SKIPPED_DIRECTORY_SUFFIXES),
        "skip_directories_containing": list(SKIPPED_DIRECTORY_MARKERS),
        "skip_file_globs": list(SKIPPED_FILE_PATTERNS),
        "input_file_globs": ["pyproject.toml"],
    }

    if absent_paths:
        found["input_absent_paths"] = sorted(absent_paths)

    return found


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


def discover(root: Path, listing: Listing | _Unread = UNREAD) -> list[str]:
    found = []
    listing = resolve_listing(root, listing)

    for current, directories, files in os.walk(root):
        current_path = Path(current)
        directories[:] = sorted(
            d for d in directories if not is_skipped_directory(current_path / d)
        )

        for name in files:
            if name.endswith(SOURCE_EXTENSIONS) and not is_skipped_file(name):
                relative = (current_path / name).relative_to(root).as_posix()

                if is_listed(listing, relative):
                    found.append(relative)

    return sorted(found)


def discover_tests(root: Path, listing: Listing | _Unread = UNREAD) -> list[str]:
    found = []
    listing = resolve_listing(root, listing)

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
                relative = (current_path / name).relative_to(root).as_posix()

                if is_listed(listing, relative):
                    found.append(relative)

    return sorted(found)
