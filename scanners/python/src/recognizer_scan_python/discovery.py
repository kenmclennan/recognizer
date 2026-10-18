import os
from fnmatch import fnmatch
from pathlib import Path

SKIPPED_DIRECTORY_NAMES = {
    "__pycache__",
    "tests",
    "dist",
    "build",
    "node_modules",
    "site-packages",
}
SKIPPED_FILE_PATTERNS = ("test_*.py", "*_test.py", "*_tests.py", "conftest.py")


def is_skipped_directory(path: Path) -> bool:
    name = path.name
    return (
        name.startswith(".")
        or name in SKIPPED_DIRECTORY_NAMES
        or name.endswith(".egg-info")
        or (path / "pyvenv.cfg").exists()
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
            if name.endswith(".py") and not is_skipped_file(name):
                found.append((current_path / name).relative_to(root).as_posix())

    return sorted(found)
