import json
import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from recognizer_sensors.hashes import listed_files
from recognizer_sensors.scans import Scan

SOLUTION_SUFFIXES = (".sln", ".slnx")


@dataclass(frozen=True)
class Project:
    language: str
    directory: str = ""
    slug: str = ""


def parent_of(path: str) -> str:
    parent = PurePosixPath(path).parent.as_posix()

    return "" if parent == "." else parent


def within(path: str, directory: str) -> bool:
    return directory == "" or path == directory or path.startswith(f"{directory}/")


def ancestors(directory: str) -> list[str]:
    found = [directory]

    while found[-1]:
        found.append(parent_of(found[-1]))

    return found


def slugify(directory: str) -> str:
    return directory.replace("/", "__")


def owner_of(projects: list[Project], path: str) -> Project | None:
    owners = [project for project in projects if within(path, project.directory)]

    return max(owners, key=lambda project: len(project.directory), default=None)


def outermost(directories: list[str]) -> list[str]:
    return [
        directory
        for directory in directories
        if not any(other != directory and within(directory, other) for other in directories)
    ]


def holding(files: list[str], name: str) -> list[str]:
    return sorted({parent_of(path) for path in files if PurePosixPath(path).name == name})


def passes_script(repository: Path, directory: str) -> bool:
    try:
        package = json.loads((repository / directory / "package.json").read_text(encoding="utf-8"))
        script = package["scripts"]["test"]
    except (OSError, ValueError, KeyError, TypeError):
        return False

    return isinstance(script, str) and bool(script)


PYTHON_CONFIG = ("pyproject.toml", "setup.cfg", "pytest.ini")


def python_directories(files: list[str]) -> list[str]:
    present = set(files)
    nested = sorted(
        {
            parent_of(path)
            for path in files
            if PurePosixPath(path).name in PYTHON_CONFIG and parent_of(path)
        }
    )
    root = any(name in present for name in (*PYTHON_CONFIG, "uv.lock", "poetry.lock"))

    return ["", *nested] if root or not nested else nested


def solution_unit(files: list[str], directory: str) -> bool:
    names = [PurePosixPath(path).name for path in files if parent_of(path) == directory]
    solutions = [name for name in names if name.endswith(SOLUTION_SUFFIXES)]
    projects = [name for name in names if name.endswith(".csproj")]

    return len(solutions) == 1 or (not solutions and len(projects) == 1)


def csharp_directories(files: list[str]) -> list[str]:
    if solution_unit(files, ""):
        return [""]

    directories = sorted(
        {
            parent_of(path)
            for path in files
            if path.endswith((*SOLUTION_SUFFIXES, ".csproj")) and parent_of(path)
        }
    )

    return outermost([d for d in directories if solution_unit(files, d)])


def directories_of(repository: Path, language: str, files: list[str]) -> list[str]:
    if language == "python":
        return python_directories(files)

    if language == "typescript":
        candidates = [d for d in holding(files, "package.json") if passes_script(repository, d)]

        return [""] if "" in candidates else candidates

    if language == "kotlin":
        wrappers = [
            d for d in holding(files, "gradlew") if os.access(repository / d / "gradlew", os.X_OK)
        ]

        return [""] if "" in wrappers else outermost(wrappers)

    if language == "rust":
        manifests = holding(files, "Cargo.toml")

        return [""] if "" in manifests else outermost(manifests)

    if language == "csharp":
        return csharp_directories(files)

    return []


def scanned_paths(scan: Scan) -> list[str]:
    paths = [path for module in scan.modules for path in module.files]

    return [*paths, *scan.skip_paths] if scan.language == "csharp" else paths


def named(language: str, directories: list[str]) -> list[Project]:
    taken: set[str] = set()
    projects: list[Project] = []

    for directory in sorted(directories):
        slug = slugify(directory)
        suffix = 2

        while directory and slug in taken:
            slug = f"{slugify(directory)}-{suffix}"
            suffix += 1

        taken.add(slug)
        projects.append(Project(language, directory, slug))

    return projects


def discover(repository: Path, scan: Scan, files: list[str] | None = None) -> list[Project]:
    listed = listed_files(repository) if files is None else files
    directories = directories_of(repository, scan.language, listed)
    projects = named(scan.language, directories)
    held = {
        owner.directory
        for path in scanned_paths(scan)
        if (owner := owner_of(projects, path)) is not None
    }

    return [project for project in projects if project.directory in held]


def resolve(repository: Path, scan: Scan, files: list[str] | None = None) -> list[Project]:
    return discover(repository, scan, files) or [Project(scan.language)]
