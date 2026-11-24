import json
from importlib.metadata import version

from conftest import REPOSITORY, validate

from recognizer_scan_python import scan

FIXTURE = REPOSITORY / "fixtures" / "supertype-edges" / "python"


def edges_from(document: dict, source: str) -> list[dict]:
    return [e for e in document["edges"] if e["from"] == source]


def test_sample_matches_expected_scan():
    actual = scan(FIXTURE / "sample", ["."], None)
    wanted = json.loads((FIXTURE / "expected-scan.json").read_text())
    wanted["scanner"]["version"] = version("recognizer-scan-python")

    assert actual == wanted
    validate(actual)


def test_a_supertype_only_reference_makes_only_the_supertype_edge():
    document = scan(FIXTURE / "sample", ["."], None)
    found = edges_from(document, "pkg/default_dispatcher.py")

    assert found
    assert [(e["to"], e["kind"]) for e in found] == [("pkg/contracts.py", "implements")]


def test_a_supertype_and_a_field_keep_both_edges():
    document = scan(FIXTURE / "sample", ["."], None)
    found = edges_from(document, "pkg/logging_dispatcher.py")

    assert sorted((e["to"], e["kind"]) for e in found) == [
        ("pkg/contracts.py", "depends"),
        ("pkg/contracts.py", "implements"),
    ]


def test_a_subclass_makes_only_an_inherits_edge():
    document = scan(FIXTURE / "sample", ["."], None)
    found = edges_from(document, "pkg/sub.py")

    assert found
    assert [(e["to"], e["kind"]) for e in found] == [("pkg/base.py", "inherits")]


def test_the_set_of_file_pairs_is_unchanged_by_dropping_supertype_depends():
    document = scan(FIXTURE / "sample", ["."], None)
    supertypes = [e for e in document["edges"] if e["kind"] in ("implements", "inherits")]

    assert len(supertypes) >= 2

    pairs = {(e["from"], e["to"]) for e in document["edges"] if not e["to"].startswith("foreign:")}
    old = pairs | {(e["from"], e["to"]) for e in supertypes}
    imports = {
        ("pkg/default_dispatcher.py", "pkg/contracts.py"),
        ("pkg/logging_dispatcher.py", "pkg/contracts.py"),
        ("pkg/sub.py", "pkg/base.py"),
    }

    assert pairs == old == imports


def test_an_unused_import_keeps_its_depends_edge(tmp_path):
    (tmp_path / "a.py").write_text("class A: ...\n")
    (tmp_path / "b.py").write_text("from a import A\n")

    document = scan(tmp_path, ["."], None)

    assert [(e["from"], e["to"], e["kind"]) for e in document["edges"]] == [
        ("b.py", "a.py", "depends")
    ]
