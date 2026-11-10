import os
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

SOURCE_EXTENSIONS = (".kt",)
SKIPPED_DIRECTORY_NAMES = (
    "build",
    "test",
    "androidTest",
    "integrationTest",
    "testFixtures",
    "test-fixtures",
)
SKIPPED_DIRECTORY_PREFIXES = (".",)
SKIPPED_DIRECTORY_SUFFIXES = ("Test",)
SKIPPED_FILE_PATTERNS = ("*Test.kt", "*Tests.kt")
BUILD_FILES = ("build.gradle", "build.gradle.kts", "pom.xml")


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
                f"recognizer-scan-kotlin: git could not list files ({first}); scanning every file",
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


def selection() -> dict:
    return {
        "extensions": list(SOURCE_EXTENSIONS),
        "skip_directory_names": list(SKIPPED_DIRECTORY_NAMES),
        "skip_directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
        "skip_directory_suffixes": list(SKIPPED_DIRECTORY_SUFFIXES),
        "skip_directories_containing": [],
        "skip_file_globs": list(SKIPPED_FILE_PATTERNS),
        "input_file_globs": list(BUILD_FILES),
    }


def is_skipped_directory(name: str) -> bool:
    return (
        name.startswith(SKIPPED_DIRECTORY_PREFIXES)
        or name in SKIPPED_DIRECTORY_NAMES
        or name.endswith(SKIPPED_DIRECTORY_SUFFIXES)
    )


def is_skipped_file(name: str) -> bool:
    return any(fnmatch(name, pattern) for pattern in SKIPPED_FILE_PATTERNS)


def discover(root: Path, listing: Listing | _Unread = UNREAD) -> list[str]:
    found = []
    listing = resolve_listing(root, listing)

    for current, directories, files in os.walk(root):
        current_path = Path(current)
        directories[:] = sorted(d for d in directories if not is_skipped_directory(d))

        for name in files:
            if name.endswith(SOURCE_EXTENSIONS) and not is_skipped_file(name):
                relative = (current_path / name).relative_to(root).as_posix()

                if is_listed(listing, relative):
                    found.append(relative)

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


def build_files_in(root: Path, module: str) -> list[str]:
    return [
        (Path(module) / name).as_posix() for name in BUILD_FILES if (root / module / name).is_file()
    ]
