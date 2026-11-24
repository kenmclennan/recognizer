import json
from importlib.metadata import version

from conftest import REPOSITORY, edges_of, validate

from recognizer_scan_csharp import scan

FIXTURE = REPOSITORY / "fixtures" / "supertype-edges" / "csharp"
CONTRACT = "Dispatcher.cs"
DEFAULT = "DefaultDispatcher.cs"
LOGGING = "LoggingDispatcher.cs"


def sample() -> dict:
    return scan(FIXTURE / "sample", None)


def test_sample_matches_expected_scan():
    actual = sample()
    wanted = json.loads((FIXTURE / "expected-scan.json").read_text())
    wanted["scanner"]["version"] = version("recognizer-scan-csharp")

    assert actual == wanted
    validate(actual)


def test_a_supertype_only_reference_makes_only_the_supertype_edge():
    edges = edges_of(sample(), DEFAULT)

    assert [(e["to"], e["kind"]) for e in edges] == [(CONTRACT, "implements")]


def test_a_supertype_and_a_field_keep_both_edges():
    edges = edges_of(sample(), LOGGING)

    assert sorted((e["to"], e["kind"]) for e in edges) == [
        (CONTRACT, "depends"),
        (CONTRACT, "implements"),
    ]


def test_a_subclass_makes_only_an_inherits_edge():
    edges = edges_of(sample(), "Derived.cs")

    assert [(e["to"], e["kind"]) for e in edges] == [("Base.cs", "inherits")]


def test_the_set_of_file_pairs_is_unchanged_by_dropping_supertype_depends():
    document = sample()
    supertype = [e for e in document["edges"] if e["kind"] in ("implements", "inherits")]
    pairs = {(e["from"], e["to"]) for e in document["edges"]}
    kept = pairs | {(e["from"], e["to"]) for e in supertype}

    assert len(supertype) >= 2
    assert pairs == kept
    assert {(DEFAULT, CONTRACT), ("Derived.cs", "Base.cs")} <= pairs
