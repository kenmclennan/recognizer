import json
import os
import re
from pathlib import Path

import pytest
from conftest import REPOSITORY, validate

from recognizer_scan_kotlin import scan_with_stats

VARIABLE = "RECOGNIZER_KOTLIN_PETCLINIC"
BASELINE = json.loads((REPOSITORY / "fixtures" / "kotlin" / "petclinic-baseline.json").read_text())
DECLARATION = r"\b(?:class|interface|object|typealias|fun|val|var)\b[^=(\n]*"
DECLARATION_END = r"\s*(?:[(<:={,]|$)|\s+(?:(?:@\w+(?:\([^)]*\))?|\w+)\s+)*constructor\b"


@pytest.fixture(scope="module")
def petclinic() -> Path:
    path = os.environ.get(VARIABLE)

    if path:
        return Path(path)

    if os.environ.get("RECOGNIZER_REQUIRE_REAL_CONTENT") == "1":
        pytest.fail(f"{VARIABLE} is unset and RECOGNIZER_REQUIRE_REAL_CONTENT is 1")

    pytest.skip(f"{VARIABLE} is unset")


@pytest.fixture(scope="module")
def result(petclinic):
    return scan_with_stats(petclinic, None)


def sources_by_file(root: Path, document: dict) -> dict[str, list[str]]:
    return {
        item["path"]: [(root / item["path"]).read_text(errors="replace")]
        for item in document["files"]
    }


def is_used(sources: list[str], name: str) -> bool:
    pattern = re.compile(rf"\b{re.escape(name)}\b")

    return any(
        pattern.search(line)
        for text in sources
        for line in text.splitlines()
        if not line.lstrip().startswith(("import ", "package "))
    )


def is_declared(sources: list[str], name: str) -> bool:
    pattern = re.compile(DECLARATION + rf"\b{re.escape(name)}(?:{DECLARATION_END})", re.MULTILINE)

    return any(pattern.search(text) for text in sources)


def edge_is_correct(edge: dict, sources: dict[str, list[str]]) -> bool:
    return all(
        is_used(sources[edge["from"]], name.split(".")[-1])
        and is_declared(sources[edge["to"]], name.split(".")[0])
        for name in edge["names"]
    )


def test_the_petclinic_scan_is_schema_valid(result):
    validate(result.document)


def test_the_petclinic_file_and_module_counts_match_the_baseline(result):
    assert len(result.document["files"]) == BASELINE["files"] == 134
    assert len(result.document["modules"]) == BASELINE["modules"] == BASELINE["files"]


def test_the_petclinic_edge_and_damaged_counts_match_the_baseline(result):
    assert len(result.document["edges"]) == BASELINE["edges"]
    assert result.damaged == BASELINE["damaged"]


def test_the_petclinic_edge_precision_holds_the_floor(petclinic, result):
    sources = sources_by_file(petclinic, result.document)
    edges = [
        e
        for e in result.document["edges"]
        if e["kind"] == "depends" and not e["to"].startswith("foreign:")
    ]
    correct = [e for e in edges if edge_is_correct(e, sources)]

    assert edges
    assert len(correct) / len(edges) >= BASELINE["precision_floor"]


@pytest.mark.parametrize(
    ("line", "name"),
    [
        ("fun <F : Enum<F>, L : ListFilters> monitorListQuery(", "monitorListQuery"),
        ("fun Set<ConstraintViolation<*>>.throwIfNotEmpty(", "throwIfNotEmpty"),
        ("inline fun <reified T : Any> HttpResponse<*>.getBodyAs()", "getBodyAs"),
        ("class MonitorListFilters internal constructor(", "MonitorListFilters"),
        ("class NiaViewModel @Inject constructor(", "NiaViewModel"),
        ("class Repo internal @Inject constructor(", "Repo"),
    ],
)
def test_is_declared_recognises_nested_generics_and_explicit_constructors(line, name):
    assert is_declared([line], name)


def test_is_declared_does_not_count_a_use_on_the_right_of_an_assignment():
    assert not is_declared(["val x = foo.bar()"], "bar")
    assert not is_declared(["val x = foo.bar()"], "foo")
