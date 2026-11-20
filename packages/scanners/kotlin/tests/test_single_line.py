import pytest
from conftest import member, module

from recognizer_scan_kotlin import scan, scan_with_stats
from recognizer_scan_kotlin.parse import PARSER, is_damaged, parse_file

SINGLE = (
    "interface Store { fun save() }\n"
    "abstract class Base\n"
    "sealed class Shape\n"
    "typealias Id = String\n"
    "typealias Ids = List<Id>\n"
    "class Impl\n"
)
MULTI = (
    "interface Store {\n    fun save()\n}\n"
    "abstract class Base\n"
    "sealed class Shape\n"
    "typealias Id = String\n"
    "typealias Ids = List<Id>\n"
    "class Impl\n"
)


def outline(document, path):
    return {
        m["name"]: (m["kind"], [x["name"] for x in m.get("methods", [])])
        for m in module(document, path)["members"]
    }


def test_single_line_declarations_scan_undamaged_with_outlines(run, tmp_path):
    document = run({"a/F.kt": SINGLE})

    assert scan_with_stats(tmp_path, None).damaged == 0
    assert [m["name"] for m in member(document, "a/F.kt", "Store")["methods"]] == ["save"]
    assert set(outline(document, "a/F.kt")) == {"Store", "Base", "Shape", "Id", "Ids", "Impl"}


def test_single_line_and_multi_line_spellings_give_the_same_outline(run, tmp_path):
    single = outline(run({"a/F.kt": SINGLE}), "a/F.kt")
    (tmp_path / "a/F.kt").write_text(MULTI)

    assert outline(scan(tmp_path, None), "a/F.kt") == single


@pytest.mark.parametrize(
    "source",
    [
        "class A { val x = 1 }\n",
        "interface I { fun f() }\n",
        "class A { class B }\n",
        "class A { val x = 1 /* c */ }\n",
        "class A { fun f() {} }\n",
    ],
)
def test_a_body_closed_on_its_last_member_line_parses_undamaged(source):
    assert not parse_file(source.encode()).damaged


def test_members_keep_their_lines_after_the_repair(run):
    document = run({"a/F.kt": "package p\n\nclass A { fun f() {} }\nclass B\n"})

    assert member(document, "a/F.kt", "A")["line"] == 3
    assert member(document, "a/F.kt", "A")["methods"][0]["line"] == 3
    assert member(document, "a/F.kt", "B")["line"] == 4


def test_a_file_the_arrow_repair_cannot_fix_stays_damaged_and_keeps_its_names(run, tmp_path):
    source = (
        "package p\n\nclass A { val x = 1 }\n\n"
        "fun U(xs: List<Int>) {\n    xs.forEach { x\n\n        ->\n        x\n    }\n}\n"
    )
    document = run({"a/F.kt": source})
    parsed = parse_file(source.encode())

    assert scan_with_stats(tmp_path, None).damaged == 1
    assert is_damaged(PARSER.parse(source.encode()).root_node)
    assert parsed.damaged
    assert {"A", "U"} <= set(outline(document, "a/F.kt"))
