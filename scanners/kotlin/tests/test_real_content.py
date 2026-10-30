import json
import os
import re
from pathlib import Path

import pytest
from conftest import REPOSITORY, validate

from recognizer_scan_kotlin import scan_with_stats

VARIABLE = "RECOGNIZER_KOTLIN_PETCLINIC"
BASELINE = json.loads((REPOSITORY / "fixtures" / "kotlin" / "petclinic-baseline.json").read_text())
DECLARATION = (
    r"\b(?:class|interface|object|typealias|fun|val|var)\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?"
)


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


def sources_by_directory(root: Path, document: dict) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}

    for item in document["files"]:
        directory = Path(item["path"]).parent.as_posix()
        found.setdefault(directory, []).append((root / item["path"]).read_text(errors="replace"))

    return found


def is_used(sources: list[str], name: str) -> bool:
    pattern = re.compile(rf"\b{re.escape(name)}\b")

    return any(
        pattern.search(line)
        for text in sources
        for line in text.splitlines()
        if not line.lstrip().startswith(("import ", "package "))
    )


def is_declared(sources: list[str], name: str) -> bool:
    pattern = re.compile(DECLARATION + rf"{re.escape(name)}\b")

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
    assert len(result.document["files"]) == BASELINE["files"] == 195
    assert len(result.document["modules"]) == BASELINE["modules"] == 72


def test_the_petclinic_edge_and_damaged_counts_match_the_baseline(result):
    assert len(result.document["edges"]) == BASELINE["edges"]
    assert result.damaged == BASELINE["damaged"]


def test_the_petclinic_edge_precision_holds_the_floor(petclinic, result):
    sources = sources_by_directory(petclinic, result.document)
    edges = [
        e
        for e in result.document["edges"]
        if e["kind"] == "depends" and not e["to"].startswith("foreign:")
    ]
    correct = [e for e in edges if edge_is_correct(e, sources)]

    assert edges
    assert len(correct) / len(edges) >= BASELINE["precision_floor"]
