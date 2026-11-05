import re

TEST_DIRECTORIES = {"test", "tests", "__tests__"}
TEST_BASENAME = re.compile(
    r"^(?:test_.*\.py|.*_test\.py|conftest\.py|.*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs))$",
    re.DOTALL,
)
ENTRY_BASENAME = re.compile(
    r"^(?:test_.*\.py|.*_test\.py|.*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs))$",
    re.DOTALL,
)


def stem_of(basename: str) -> str:
    dot = basename.rfind(".")

    return basename[:dot] if dot > 0 else basename


def in_dotnet_test_project(directories: list[str], basename: str) -> bool:
    return basename.endswith(".cs") and any(
        segment.endswith("Test") or segment.endswith("Tests") for segment in directories
    )


def is_test_file(module_id: str) -> bool:
    *directories, basename = module_id.split("/")

    if any(segment in TEST_DIRECTORIES for segment in directories):
        return True

    if in_dotnet_test_project(directories, basename):
        return True

    if TEST_BASENAME.match(basename):
        return True

    stem = stem_of(basename)

    return stem.endswith("Test") or stem.endswith("Tests")


def is_rust_test_entry(directories: list[str], basename: str) -> bool:
    if "src" in directories:
        return False

    if directories[-1:] == ["tests"]:
        return basename.endswith(".rs")

    return directories[-2:-1] == ["tests"] and basename == "main.rs"


def is_test_entry(module_id: str) -> bool:
    *directories, basename = module_id.split("/")

    if ENTRY_BASENAME.match(basename):
        return True

    if basename.endswith(".kt") and any(segment in TEST_DIRECTORIES for segment in directories):
        return True

    if in_dotnet_test_project(directories, basename):
        return True

    if is_rust_test_entry(directories, basename):
        return True

    stem = stem_of(basename)

    return stem.endswith("Test") or stem.endswith("Tests")
