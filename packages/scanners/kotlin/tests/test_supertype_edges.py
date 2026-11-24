import json
from importlib.metadata import version

from conftest import REPOSITORY, validate

from recognizer_scan_kotlin import scan

FIXTURE = REPOSITORY / "fixtures" / "supertype-edges" / "kotlin"
CONTRACTS = "src/main/kotlin/p/Contracts.kt"
DEFAULT = "src/main/kotlin/p/DefaultDispatcher.kt"
LOGGING = "src/main/kotlin/p/LoggingDispatcher.kt"
DERIVED = "src/main/kotlin/p/Derived.kt"


def fixture_scan() -> dict:
    return scan(FIXTURE / "sample", None)


def edges_from(document: dict, source: str) -> list[dict]:
    return [e for e in document["edges"] if e["from"] == source and e["to"] == CONTRACTS]


def test_sample_matches_expected_scan():
    actual = fixture_scan()
    wanted = json.loads((FIXTURE / "expected-scan.json").read_text())
    wanted["scanner"]["version"] = version("recognizer-scan-kotlin")

    assert actual == wanted
    validate(actual)


def test_a_supertype_only_reference_makes_only_the_supertype_edge():
    found = edges_from(fixture_scan(), DEFAULT)

    assert found
    assert [e["kind"] for e in found] == ["implements"]


def test_a_supertype_and_a_field_keep_both_edges():
    found = edges_from(fixture_scan(), LOGGING)

    assert found
    assert sorted(e["kind"] for e in found) == ["depends", "implements"]


def test_a_subclass_makes_only_an_inherits_edge():
    found = edges_from(fixture_scan(), DERIVED)

    assert found
    assert [e["kind"] for e in found] == ["inherits"]


def test_the_set_of_file_pairs_is_unchanged_by_dropping_supertype_depends():
    document = fixture_scan()
    supertype = [e for e in document["edges"] if e["kind"] in ("implements", "inherits")]

    assert len(supertype) >= 2

    pairs = {(e["from"], e["to"]) for e in document["edges"]}
    doubled = pairs | {(e["from"], e["to"]) for e in supertype}

    assert pairs == doubled
    assert (DEFAULT, CONTRACTS) in pairs
    assert (DERIVED, CONTRACTS) in pairs


def test_an_unused_import_is_unchanged(run):
    document = run(
        {
            "q/Helper.kt": "package q\n\nclass Helper\n",
            "p/Idle.kt": "package p\n\nimport q.Helper\n\nclass Idle\n",
        }
    )

    assert document["edges"] == []


def test_a_qualified_supertype_makes_only_the_supertype_edge(run):
    document = run(
        {
            "q/Contract.kt": "package q\n\ninterface Contract\n",
            "p/Impl.kt": "package p\n\nclass Impl : q.Contract\n",
        }
    )

    assert [e["kind"] for e in document["edges"]] == ["implements"]


def test_an_imported_supertype_makes_only_the_supertype_edge(run):
    document = run(
        {
            "q/Contract.kt": "package q\n\ninterface Contract\n",
            "p/Impl.kt": "package p\n\nimport q.Contract\n\nclass Impl : Contract\n",
        }
    )

    assert [e["kind"] for e in document["edges"]] == ["implements"]


def test_a_supertype_used_as_a_return_type_keeps_both_edges(run):
    document = run(
        {
            "q/Contract.kt": "package q\n\ninterface Contract\n",
            "p/Impl.kt": (
                "package p\n\nimport q.Contract\n\nclass Impl : Contract {\n"
                "    fun self(): Contract = this\n}\n"
            ),
        }
    )

    assert sorted(e["kind"] for e in document["edges"]) == ["depends", "implements"]
