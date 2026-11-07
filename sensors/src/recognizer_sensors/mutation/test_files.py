import re

TEST_DIRECTORIES = {"test", "tests", "__tests__"}
SCRIPT_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]
SCRIPT_ALTERNATION = "|".join(SCRIPT_EXTENSIONS)
TEST_BASENAME = re.compile(
    rf"^(?:test_.*\.py|.*_test\.py|conftest\.py|.*\.(?:test|spec)\.(?:{SCRIPT_ALTERNATION}))$",
    re.DOTALL,
)
ENTRY_BASENAME = re.compile(
    rf"^(?:test_.*\.py|.*_test\.py|.*\.(?:test|spec)\.(?:{SCRIPT_ALTERNATION}))$",
    re.DOTALL,
)
SCRIPT_TEST_SUFFIX = re.compile(rf"\.(test|spec)\.({SCRIPT_ALTERNATION})$")


def is_script_test_file(path: str) -> bool:
    return SCRIPT_TEST_SUFFIX.search(path) is not None


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
