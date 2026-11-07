import json
import os
import re
from pathlib import Path

import pytest
from conftest import REPOSITORY, validate

from recognizer_scan_csharp import scan_with_stats

VARIABLE = "RECOGNIZER_CSHARP_ESHOP"
BASELINE = json.loads((REPOSITORY / "fixtures" / "csharp" / "eshop-baseline.json").read_text())
SAMPLE_SIZE = 30
MODIFIERS = r"\b(?:public|internal|private|protected|static)\b"
FREED = (
    "src/ClientApp/Animations/FadeToAnimation.cs",
    "src/ClientApp/Animations/StoryBoard.cs",
    "src/ClientApp/Controls/ToggleButton.cs",
    "src/ClientApp/Converters/DoesNotHaveCountConverter.cs",
    "src/ClientApp/Converters/HasCountConverter.cs",
    "src/ClientApp/Converters/ItemsToHeightConverter.cs",
    "src/ClientApp/Triggers/BeginAnimation.cs",
    "src/ClientApp/Views/BadgeView.cs",
    "src/ClientApp/Views/ContentPageBase.cs",
    "src/Identity.API/Models/ErrorViewModel.cs",
)
TYPE_KEYWORDS = r"\b(?:class|interface|struct|enum|record|delegate)\b[^;{=(]*"


@pytest.fixture(scope="module")
def eshop() -> Path:
    path = os.environ.get(VARIABLE)

    if path:
        return Path(path)

    if os.environ.get("RECOGNIZER_REQUIRE_REAL_CONTENT") == "1":
        pytest.fail(f"{VARIABLE} is unset and RECOGNIZER_REQUIRE_REAL_CONTENT is 1")

    pytest.skip(f"{VARIABLE} is unset")


@pytest.fixture(scope="module")
def result(eshop):
    return scan_with_stats(eshop, None)


def orphans_of(document: dict) -> list[str]:
    reached = {e["to"] for e in document["edges"] if e["from"] != e["to"]}

    return [
        m["id"]
        for m in document["modules"]
        if m["id"] not in reached and not m.get("entry_point") and m["members"]
    ]


def sources_by_file(root: Path, document: dict) -> dict[str, str]:
    return {
        item["path"]: (root / item["path"]).read_text(encoding="utf-8-sig", errors="replace")
        for item in document["files"]
    }


def is_used(text: str, name: str) -> bool:
    pattern = re.compile(rf"\b{re.escape(name)}\b")

    return any(
        pattern.search(line)
        for line in text.splitlines()
        if not line.lstrip().startswith(("using ", "namespace "))
    )


def is_declared(text: str, name: str) -> bool:
    escaped = re.escape(name)
    pattern = re.compile(
        rf"{TYPE_KEYWORDS}\b{escaped}\b|{MODIFIERS}[^;{{}}=]*\b{escaped}\s*[(<]", re.MULTILINE
    )

    return bool(pattern.search(text))


MARKUP_SUFFIXES = (".razor", ".cshtml", ".xaml")


def project_directory_of(root: Path, path: str) -> str:
    directory = Path(path).parent

    while True:
        if any((root / directory).glob("*.csproj")):
            return directory.as_posix()

        if directory == directory.parent:
            return "."

        directory = directory.parent


def used_text(root: Path, edge: dict, sources: dict[str, str]) -> str:
    base = project_directory_of(root, edge["from"])
    prefix = "" if base == "." else base + "/"
    markup = [
        text
        for path, text in sources.items()
        if path.endswith(MARKUP_SUFFIXES) and path.startswith(prefix)
    ]

    return "\n".join([sources[edge["from"]], *markup])


def edge_is_correct(root: Path, edge: dict, sources: dict[str, str]) -> bool:
    used = used_text(root, edge, sources)

    return all(
        is_used(used, name) and is_declared(sources[edge["to"]], name) for name in edge["names"]
    )


def test_the_eshop_scan_is_schema_valid(result):
    validate(result.document)


def test_the_eshop_file_and_module_counts_match_the_baseline(result):
    assert len(result.document["files"]) == BASELINE["files"] == 605
    assert BASELINE["markup_files"] == 83
    assert BASELINE["non_source_files"] == 33
    assert len(result.document["modules"]) == BASELINE["modules"] == 489
    assert BASELINE["modules"] == (
        BASELINE["files"] - BASELINE["markup_files"] - BASELINE["non_source_files"]
    )


def test_the_eshop_damaged_count_matches_the_baseline(result):
    assert result.damaged == BASELINE["damaged"] == 2


def test_the_eshop_edge_count_matches_the_baseline(result):
    assert len(result.document["edges"]) == BASELINE["edges"]


def test_the_eshop_call_count_matches_the_baseline(result):
    assert len(result.document["calls"]) == BASELINE["calls"]


def test_the_eshop_calls_end_at_members_and_never_at_their_source(result):
    members = set()

    for item in result.document["modules"]:
        for entry in item["members"]:
            members.add(f"{item['id']}::{entry['name']}")
            members.update(f"{item['id']}::{entry['name']}.{m['name']}" for m in entry["methods"])

    for call in result.document["calls"]:
        assert call["from"] in members
        assert call["to"] in members
        assert call["from"] != call["to"]


def test_the_eshop_call_precision_on_a_sample_of_thirty_is_non_gating(
    eshop, result, record_property
):
    sources = sources_by_file(eshop, result.document)
    calls = [c for c in result.document["calls"] if c["how"] == "call"]
    step = max(1, len(calls) // SAMPLE_SIZE)
    sample = calls[::step][:SAMPLE_SIZE]

    def method_of(ref: str) -> str:
        return ref.split("::")[1].split(".")[-1]

    correct = [
        c
        for c in sample
        if is_used(sources[c["from"].split("::")[0]], method_of(c["to"]))
        and is_declared(sources[c["to"].split("::")[0]], method_of(c["to"]))
    ]

    record_property("precision", len(correct) / len(sample))

    assert len(sample) == SAMPLE_SIZE


def test_the_eshop_orphan_count_matches_the_baseline(result):
    assert len(orphans_of(result.document)) == BASELINE["orphans"] == 50


def test_the_eshop_edge_precision_holds_the_floor_on_a_sample_of_thirty(eshop, result):
    sources = sources_by_file(eshop, result.document)
    edges = [
        e
        for e in result.document["edges"]
        if e["kind"] == "depends" and not e["to"].startswith("foreign:") and e.get("names")
    ]
    step = max(1, len(edges) // SAMPLE_SIZE)
    sample = edges[::step][:SAMPLE_SIZE]
    correct = [e for e in sample if edge_is_correct(eshop, e, sources)]

    assert len(sample) == SAMPLE_SIZE
    assert len(correct) / len(sample) >= BASELINE["precision_floor"]


def test_the_ten_freed_files_are_no_longer_orphans(result):
    orphans = set(orphans_of(result.document))

    assert not orphans & set(FREED)


def test_is_declared_recognises_types_and_methods():
    assert is_declared("public sealed class Foo<T> : Base", "Foo")
    assert is_declared("public static int Twice(this int x)", "Twice")
    assert not is_declared("var x = new Foo();", "Foo")
