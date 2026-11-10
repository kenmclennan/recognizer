import os
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

SOURCE_EXTENSIONS = (".cs",)
MARKUP_EXTENSIONS = (".razor", ".cshtml", ".xaml")
LEFT_OUT_EXTENSIONS = (".fs", ".vb")
SKIPPED_DIRECTORY_NAMES = ("bin", "obj")
SKIPPED_DIRECTORY_PREFIXES = (".",)
SKIPPED_FILE_PATTERNS = ("*.g.cs", "*.g.i.cs", "*.Designer.cs")
SOLUTION_EXTENSIONS = (".sln", ".slnx")


INPUT_FILE_GLOBS = ("*.csproj", "Directory.Build.props", "*.sln", "*.slnx")


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
                f"recognizer-scan-csharp: git could not list files ({first}); scanning every file",
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


def selection(skip_paths: list[str] | None = None, absent_paths: list[str] | None = None) -> dict:
    found = {
        "extensions": [*SOURCE_EXTENSIONS, *MARKUP_EXTENSIONS],
        "skip_directory_names": list(SKIPPED_DIRECTORY_NAMES),
        "skip_directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
        "skip_directory_suffixes": [],
        "skip_directories_containing": [],
        "skip_file_globs": list(SKIPPED_FILE_PATTERNS),
        "skip_paths": list(skip_paths or []),
        "input_file_globs": list(INPUT_FILE_GLOBS),
    }

    if absent_paths:
        found["input_absent_paths"] = sorted(absent_paths)

    return found


def is_skipped_directory(name: str) -> bool:
    return name.startswith(SKIPPED_DIRECTORY_PREFIXES) or name in SKIPPED_DIRECTORY_NAMES


def is_skipped_file(name: str) -> bool:
    return any(fnmatch(name, pattern) for pattern in SKIPPED_FILE_PATTERNS)


class Discovered:
    def __init__(self) -> None:
        self.sources: list[str] = []
        self.markup: list[str] = []
        self.projects: list[str] = []
        self.solutions: list[str] = []
        self.left_out: dict[str, int] = {extension: 0 for extension in LEFT_OUT_EXTENSIONS}


def discover(root: Path, listing: Listing | _Unread = UNREAD) -> Discovered:
    found = Discovered()
    listing = resolve_listing(root, listing)

    for current, directories, files in os.walk(root):
        current_path = Path(current)
        directories[:] = sorted(d for d in directories if not is_skipped_directory(d))

        for name in sorted(files):
            relative = (current_path / name).relative_to(root).as_posix()

            if not is_listed(listing, relative):
                continue

            if name.endswith(SOURCE_EXTENSIONS):
                if not is_skipped_file(name):
                    found.sources.append(relative)
            elif name.endswith(MARKUP_EXTENSIONS):
                found.markup.append(relative)
            elif name.endswith(".csproj"):
                found.projects.append(relative)
            elif name.endswith(SOLUTION_EXTENSIONS):
                found.solutions.append(relative)
            elif name.endswith(LEFT_OUT_EXTENSIONS):
                found.left_out[Path(name).suffix] += 1

    found.sources.sort()
    found.markup.sort()
    found.projects.sort()
    found.solutions.sort()

    return found


def directory_of(path: str) -> str:
    return Path(path).parent.as_posix()
