import re
from pathlib import PurePosixPath

TEST_DIRECTORIES = {"test", "tests", "__tests__"}
INDEX_STEMS = {"index", "__init__", "main", "mod", "lib"}
TEST_BASENAME = re.compile(
    r"^(?:test_.*\.py|.*_test\.py|conftest\.py|.*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs))$",
    re.DOTALL,
)
SPECIAL = set(".+^${}()|[]\\")


def stem_of(basename: str) -> str:
    dot = basename.rfind(".")

    return basename[:dot] if dot > 0 else basename


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    if pattern in ("*", "**"):
        return re.compile(r"[\s\S]*\Z")

    source = ""
    i = 0

    while i < len(pattern):
        if pattern.startswith("**/", i):
            source += "(?:.*/)?"
            i += 3
        elif pattern[i:] == "/**":
            source += "(?:/.*)?"
            i += 3
        elif pattern.startswith("**", i):
            source += ".*"
            i += 2
        elif pattern[i] == "*":
            source += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            source += "[^/]"
            i += 1
        else:
            char = pattern[i]
            source += "\\" + char if char in SPECIAL else char
            i += 1

    return re.compile(f"^{source}\\Z", re.DOTALL)


def is_test_file(module_id: str) -> bool:
    *directories, basename = module_id.split("/")

    if any(segment in TEST_DIRECTORIES for segment in directories):
        return True

    if TEST_BASENAME.match(basename):
        return True

    stem = stem_of(basename)

    return stem.endswith("Test") or stem.endswith("Tests")


def is_entry_point(module_id: str, entry_globs: list[str]) -> bool:
    if is_test_file(module_id):
        return True

    if stem_of(PurePosixPath(module_id).name) in INDEX_STEMS:
        return True

    return any(glob_to_regex(glob).search(module_id) for glob in entry_globs)
