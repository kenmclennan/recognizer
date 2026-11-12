import json

import pytest
from conftest import REPOSITORY

from recognizer_sensors.functions import find_functions
from recognizer_sensors.identity import assign_identities
from recognizer_sensors.parsing import grammar_for, parse

EQUIVALENCE = REPOSITORY / "fixtures" / "duplication" / "equivalence"
SOURCE_ROOTS = (
    "fixtures/duplication/corpus",
    "fixtures/duplication/sample",
    "fixtures/crap/corpus",
    "fixtures/duplication/equivalence/sources",
)
LANGUAGE_EXTENSIONS = {
    "python": {".py"},
    "typescript": {".ts", ".tsx", ".js"},
    "kotlin": {".kt"},
    "rust": {".rs"},
    "csharp": {".cs"},
}


def source_files(language: str) -> list[str]:
    found = [
        path.relative_to(REPOSITORY).as_posix()
        for root in SOURCE_ROOTS
        for path in (REPOSITORY / root).rglob("*")
        if path.is_file() and path.suffix in LANGUAGE_EXTENSIONS[language]
    ]

    return sorted(found)


def function_records(language: str) -> list[dict]:
    items = []

    for relative in source_files(language):
        grammar = grammar_for(relative)
        tree = parse(grammar, (REPOSITORY / relative).read_bytes())

        for found in find_functions(tree.root_node, grammar):
            items.append((relative, found.qualified, found.node.start_point[0] + 1))

    identities = assign_identities(items)

    return [
        {"module": module, "name": name, "start_line": line, "identity": identity}
        for (module, name, line), identity in zip(items, identities, strict=True)
    ]


@pytest.mark.parametrize("language", sorted(LANGUAGE_EXTENSIONS))
def test_python_function_identities_equal_the_committed_golden(language):
    golden = json.loads((EQUIVALENCE / f"functions.{language}.json").read_text())

    assert len(golden) > 20
    assert function_records(language) == golden


def test_the_golden_holds_a_duplicate_name_with_a_line_suffix():
    golden = json.loads((EQUIVALENCE / "functions.python.json").read_text())
    suffixed = [row["identity"] for row in golden if "Store.get" in row["identity"]]

    assert len(suffixed) == 2
    assert all("@" in identity for identity in suffixed)
