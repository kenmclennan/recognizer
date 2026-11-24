import os
import posixpath
import re
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

SOURCE_EXTENSIONS = (".kt",)
SKIPPED_DIRECTORY_NAMES = (
    "build",
    "node_modules",
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
GRADLE_BUILD_FILES = ("build.gradle", "build.gradle.kts")
SOURCE_SET_LANGUAGES = ("kotlin", "java")
SOURCE_FOLDER_CALL = re.compile(r"\b(?:srcDir|srcDirs|setSrcDirs)\b")
COLLECTION_WRAPPERS = re.compile(r"\b(?:listOf|setOf|arrayOf|mutableListOf)\b")
STRING_LITERAL = re.compile(r"""^(?:"[^"$\\]*"|'[^'$\\]*')$""")


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

    return keep_gradle_source_folders(root, sorted(found))


def balanced_arguments(text: str, start: int) -> str | None:
    depth = 0

    for index in range(start, len(text)):
        if text[index] == "(":
            depth += 1
        elif text[index] == ")":
            depth -= 1

            if depth == 0:
                return text[start + 1 : index]

    return None


def declared_folders(text: str) -> tuple[list[str], bool]:
    folders = []
    readable = True

    for call in SOURCE_FOLDER_CALL.finditer(text):
        position = call.end()
        following = text[position:].lstrip(" \t")

        if following.startswith("("):
            argument = balanced_arguments(text, text.index("(", position))
        else:
            argument = re.split(r"[\n}]", following, maxsplit=1)[0]

        if argument is None:
            readable = False
            continue

        argument = COLLECTION_WRAPPERS.sub("", argument)
        argument = re.sub(r"[=\[\]()]", " ", argument)
        tokens = [token.strip() for token in argument.split(",") if token.strip()]

        if not tokens or not all(STRING_LITERAL.match(token) for token in tokens):
            readable = False
            continue

        folders.extend(token[1:-1] for token in tokens)

    return folders, readable


def has_default_source_folder(segments: list[str]) -> bool:
    return any(
        segments[index] == "src" and segments[index + 2] in SOURCE_SET_LANGUAGES
        for index in range(len(segments) - 3)
    )


def resolve_inside(module: str, folder: str) -> str | None:
    if folder.startswith("/"):
        return None

    resolved = posixpath.normpath(posixpath.join(module, folder))

    if resolved == ".." or resolved.startswith("../"):
        return None

    if module != "." and not (resolved + "/").startswith(module + "/"):
        return None

    return resolved


class GradleModule:
    def __init__(self, root: Path, module: str):
        self.folders: list[str] = []

        for name in GRADLE_BUILD_FILES:
            build_file = (Path(module) / name).as_posix()

            if not (root / build_file).is_file():
                continue

            text = (root / build_file).read_text(encoding="utf-8", errors="replace")
            folders, readable = declared_folders(text)

            for folder in folders:
                resolved = resolve_inside(module, folder)

                if resolved is None:
                    readable = False
                else:
                    self.folders.append(resolved)

            if not readable:
                print(
                    f"recognizer-scan-kotlin: {build_file} declares a source folder "
                    "the scanner cannot read; reading its default src/<set> folders only",
                    file=sys.stderr,
                )

    def keeps(self, module: str, path: str) -> bool:
        return has_default_source_folder(below_module(module, path).split("/")) or any(
            path.startswith(folder + "/") for folder in self.folders
        )


def keep_gradle_source_folders(root: Path, paths: list[str]) -> list[str]:
    owners = {path: build_module_of(root, directory_of(path)) for path in paths}
    modules: dict[str, GradleModule | None] = {}

    for module in set(owners.values()):
        is_gradle = any((root / module / name).is_file() for name in GRADLE_BUILD_FILES)
        standard_layout = any(
            has_default_source_folder(below_module(module, path).split("/"))
            for path in paths
            if owners[path] == module
        )
        modules[module] = GradleModule(root, module) if is_gradle and standard_layout else None

    return [
        path
        for path in paths
        if modules[owners[path]] is None or modules[owners[path]].keeps(owners[path], path)
    ]


def below_module(module: str, path: str) -> str:
    return path if module == "." else path[len(module) + 1 :]


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
