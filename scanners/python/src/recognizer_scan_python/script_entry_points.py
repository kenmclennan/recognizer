import os
import tomllib
from pathlib import Path, PurePosixPath

from recognizer_scan_python.discovery import is_skipped_directory
from recognizer_scan_python.index import ModuleIndex

MANIFEST = "pyproject.toml"
SCRIPT_TABLES = ("scripts", "gui-scripts")


def find_manifests(root: Path) -> list[str]:
    found = []

    for current, directories, files in os.walk(root):
        current_path = Path(current)
        directories[:] = sorted(
            d for d in directories if not is_skipped_directory(current_path / d)
        )

        if MANIFEST in files:
            found.append((current_path / MANIFEST).relative_to(root).as_posix())

    return sorted(found)


def script_modules(document: dict) -> list[str]:
    project = document.get("project")

    if not isinstance(project, dict):
        return []

    names = []

    for key in SCRIPT_TABLES:
        scripts = project.get(key)

        if not isinstance(scripts, dict):
            continue

        for value in scripts.values():
            if isinstance(value, str):
                names.append(value.split(":", 1)[0].strip())

    return names


def resolve(
    name: str, directory: PurePosixPath, index: ModuleIndex, module_ids: set[str]
) -> str | None:
    parts = tuple(name.split("."))

    if not all(part.isidentifier() for part in parts):
        return None

    found = index.exact(parts)

    if found is not None and PurePosixPath(found).is_relative_to(directory):
        return found

    for base in (directory, directory / "src"):
        stem = base.joinpath(*parts)

        for candidate in (stem.with_suffix(".py"), stem / "__init__.py"):
            if candidate.as_posix() in module_ids:
                return candidate.as_posix()

    return None


def script_entry_points(
    root: Path, index: ModuleIndex, module_ids: list[str]
) -> tuple[set[str], list[str]]:
    known = set(module_ids)
    marked: set[str] = set()
    read: list[str] = []

    for manifest in find_manifests(root):
        try:
            text = (root / manifest).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        try:
            document = tomllib.loads(text)
        except ValueError:
            continue

        read.append(manifest)

        names = script_modules(document)

        directory = PurePosixPath(manifest).parent

        for name in names:
            target = resolve(name, directory, index, known)

            if target is not None:
                marked.add(target)

    return marked, read
