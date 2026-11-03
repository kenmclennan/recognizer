import re

TEST_DIRECTORIES = {"test", "tests", "__tests__"}
TEST_BASENAME = re.compile(
    r"^(?:test_.*\.py|.*_test\.py|conftest\.py|.*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs))$",
    re.DOTALL,
)


def stem_of(basename: str) -> str:
    dot = basename.rfind(".")

    return basename[:dot] if dot > 0 else basename


def is_test_file(module_id: str) -> bool:
    *directories, basename = module_id.split("/")

    if any(segment in TEST_DIRECTORIES for segment in directories):
        return True

    if TEST_BASENAME.match(basename):
        return True

    stem = stem_of(basename)

    return stem.endswith("Test") or stem.endswith("Tests")
