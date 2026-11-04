import json
from importlib.metadata import version

from conftest import REPOSITORY, member, validate

from recognizer_scan_kotlin import scan

FIXTURE = REPOSITORY / "fixtures" / "abstractness" / "kotlin"
CONTRACTS = "src/main/kotlin/p/Contracts.kt"
SHAPES = "src/main/kotlin/p/Shapes.kt"


def test_sample_matches_expected_scan():
    actual = scan(FIXTURE / "sample", None)
    wanted = json.loads((FIXTURE / "expected-scan.json").read_text())
    wanted["scanner"]["version"] = version("recognizer-scan-kotlin")

    assert actual == wanted
    validate(actual)


def test_only_the_abstract_class_is_tagged():
    document = scan(FIXTURE / "sample", None)

    assert member(document, CONTRACTS, "Base")["tags"] == ["abstract"]

    for module_id, name in (
        (CONTRACTS, "Store"),
        (CONTRACTS, "Handler"),
        (SHAPES, "Id"),
        (SHAPES, "Ids"),
        (SHAPES, "Row"),
        (SHAPES, "Shape"),
        (SHAPES, "Impl"),
        (SHAPES, "Color"),
    ):
        assert "tags" not in member(document, module_id, name)


def test_a_companion_of_an_abstract_class_is_untagged(run):
    document = run(
        {
            "src/main/kotlin/p/A.kt": (
                "package p\n\nabstract class A {\n    companion object {\n        fun make() {}\n    }\n}\n"
            )
        }
    )

    members = document["modules"][0]["members"]

    assert next(m for m in members if m["name"] == "A")["tags"] == ["abstract"]
    assert all("tags" not in m for m in members if m["name"] != "A")
