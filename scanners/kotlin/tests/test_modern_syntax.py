import json

from conftest import REPOSITORY, member, validate

from recognizer_scan_kotlin import scan_with_stats
from recognizer_scan_kotlin.declarations import read_declarations
from recognizer_scan_kotlin.parse import parse_file, repair_lambda_arrows

FIXTURE = REPOSITORY / "fixtures" / "kotlin" / "modern-syntax"
LAMBDA_ARROW_ON_NEXT_LINE = "package m\n\nclass A {\n    fun run(xs: List<Int>) {\n        xs.forEach { x\n            ->\n            shout(x)\n        }\n    }\n\n    fun other() {}\n}\n"
LAMBDA_ARROW_AFTER_A_BLANK_LINE = LAMBDA_ARROW_ON_NEXT_LINE.replace(
    "x\n            ->", "x\n\n            ->"
)


def test_the_modern_syntax_fixture_matches_its_hand_derived_scan():
    wanted = json.loads((FIXTURE / "expected.json").read_text())
    result = scan_with_stats(FIXTURE, None)
    document = result.document

    assert (result.damaged, result.total) == (wanted["damaged"], wanted["files"]) == (0, 3)
    assert document["modules"] == wanted["modules"]
    assert document["edges"] == wanted["edges"]
    assert document["calls"] == wanted["calls"]
    validate(document)


def test_a_when_guard_and_context_parameters_parse_without_error():
    for name in ("Guards.kt", "Contexts.kt"):
        parsed = parse_file((FIXTURE / "src/main/kotlin/m" / name).read_bytes())

        assert not parsed.damaged


def test_a_lambda_arrow_on_the_next_line_is_repaired_and_keeps_the_class_outline(run):
    assert not parse_file(LAMBDA_ARROW_ON_NEXT_LINE.encode()).damaged

    document = run({"F.kt": LAMBDA_ARROW_ON_NEXT_LINE})
    methods = member(document, "F.kt", "A")["methods"]

    assert [(m["name"], m["line"], m["end_line"]) for m in methods] == [
        ("run", 4, 9),
        ("other", 11, 11),
    ]


def test_a_lambda_arrow_after_a_blank_line_is_still_damaged_and_keeps_its_names():
    parsed = parse_file(LAMBDA_ARROW_AFTER_A_BLANK_LINE.encode())

    assert parsed.damaged
    assert [d.name for d in read_declarations(parsed.roots)] == ["A"]


def test_the_lambda_arrow_repair_moves_the_arrow_up_and_keeps_every_line():
    source = "a { x\n    -> y }\nb\n"
    repaired = repair_lambda_arrows(source)

    assert repaired == "a { x ->\n       y }\nb\n"
    assert repaired.count("\n") == source.count("\n")


def test_the_lambda_arrow_repair_leaves_other_text_unchanged():
    for source in ("a { x -> y }\n", "fun f() {\n    -> y\n}\n", "x\n\n-> y\n", "val s = 1\n"):
        assert repair_lambda_arrows(source) == source


def test_a_shebang_line_is_not_damage():
    assert not parse_file(b"#!/usr/bin/env kotlin\npackage m\n\nclass A\n").damaged
