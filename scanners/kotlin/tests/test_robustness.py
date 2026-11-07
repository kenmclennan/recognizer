import pytest
import tree_sitter_kotlin
from conftest import FIXTURE_ROOT, build_tree, member, module
from tree_sitter import Language, Parser

from recognizer_scan_kotlin import scan, scan_with_stats
from recognizer_scan_kotlin.cli import main
from recognizer_scan_kotlin.parse import parse_file

PARSER = Parser(Language(tree_sitter_kotlin.language()))
STACKED = FIXTURE_ROOT / "app/src/main/kotlin/shop/application/UseCase.kt"
ONE_LINE = FIXTURE_ROOT / "app/src/main/kotlin/shop/domain/Currency.kt"


def top_level_types(path) -> list[str]:
    return [c.type for c in PARSER.parse(path.read_bytes()).root_node.children]


DAMAGED_COMPANION = "class A {\n companion object { const val K = 1 }\n val = \n}\n"
DAMAGED_ANNOTATED_OBJECT = (
    "fun K(xs: List<Int>) {\n    xs.forEach { x\n\n        ->\n        x\n    }\n}\n"
)


def test_precondition_a_whole_file_parse_of_stacked_annotations_is_a_class_declaration():
    types = top_level_types(STACKED)

    assert "annotated_expression" not in types
    assert "class_declaration" in types
    assert not parse_file(STACKED.read_bytes()).damaged


def test_precondition_the_retargeted_triggers_are_damaged():
    for source in (DAMAGED_COMPANION, DAMAGED_ANNOTATED_OBJECT):
        assert parse_file(source.encode()).damaged


def test_precondition_a_one_line_companion_parses_without_an_error_node():
    assert not PARSER.parse(ONE_LINE.read_bytes()).root_node.has_error


def test_a_misparsed_declaration_is_recovered_as_a_member_with_its_visibility(run):
    document = run(
        {
            "a/UseCase.kt": (
                "package p\n\n@Target(AnnotationTarget.CLASS)\n@Retention(AnnotationRetention.RUNTIME)\n"
                "@Singleton\nprivate annotation class UseCase\n"
            )
        }
    )
    found = member(document, "a/UseCase.kt", "UseCase")

    assert (found["kind"], found["visibility"], found["exported"]) == ("class", "private", False)


def test_a_damaged_file_keeps_the_names_the_tree_still_holds(run):
    document = run(
        {
            "a/F.kt": (
                "package p\n\n"
                "class A {\n companion object { const val K = 1 }\n val = \n}\n\n"
                "internal interface B\n\n"
                "fun helper(x: Int) = x\n"
            )
        }
    )
    names = {m["name"]: (m["kind"], m["visibility"]) for m in module(document, "a/F.kt")["members"]}

    assert names == {
        "A": ("class", "public"),
        "A.Companion": ("class", "public"),
        "B": ("interface", "internal"),
        "helper": ("function", "public"),
    }
    assert member(document, "a/F.kt", "A")["methods"] == []


def test_a_damaged_span_in_a_good_declaration_keeps_the_others_outlines(run):
    document = run(
        {
            "a/F.kt": (
                "package p\n\n"
                "class Good(val x: Int) {\n    fun f() = 1\n}\n\n"
                "class A {\n companion object { const val K = 1 }\n val = \n}\n"
            )
        }
    )

    assert [m["name"] for m in member(document, "a/F.kt", "Good")["methods"]] == ["f"]


def test_a_damaged_span_keeps_the_calls_that_still_parse(run):
    document = run(
        {
            "a/F.kt": (
                "package p\n\n"
                "fun target() = 1\n\n"
                "class A {\n companion object { fun f() { target() } }\n val = \n}\n"
            )
        }
    )

    assert [(c["from"], c["to"]) for c in document["calls"]] == [
        ("a/F.kt::A.Companion.f", "a/F.kt::target")
    ]


def test_the_fixture_scans_without_damage():
    result = scan_with_stats(FIXTURE_ROOT, None)

    assert (result.damaged, result.total) == (0, 10)


def test_the_damaged_count_is_reported_for_a_damaged_file(tmp_path):
    build_tree(tmp_path, {"A.kt": DAMAGED_ANNOTATED_OBJECT, "B.kt": "class B\n"})

    assert (scan_with_stats(tmp_path, None).damaged, scan_with_stats(tmp_path, None).total) == (
        1,
        2,
    )


def test_the_cli_prints_one_stderr_line_when_files_are_damaged(tmp_path, capsys):
    build_tree(
        tmp_path,
        {"A.kt": DAMAGED_ANNOTATED_OBJECT, "B.kt": "class B\n"},
    )

    assert main([str(tmp_path), "--output", str(tmp_path / "out.json")]) == 0
    assert capsys.readouterr().err == "recognizer-scan-kotlin: 1 of 2 files had damaged spans\n"


def test_the_cli_prints_nothing_when_no_file_is_damaged(tmp_path, capsys):
    build_tree(tmp_path, {"B.kt": "class B\n"})

    assert main([str(tmp_path), "--output", str(tmp_path / "out.json")]) == 0
    assert capsys.readouterr().err == ""


def test_braces_in_strings_and_comments_do_not_split_a_declaration(run):
    document = run(
        {
            "a/F.kt": (
                "package p\n\n"
                '// }\nclass A { companion object { const val K = "}" } }\n\n'
                "/* {\nval hidden = 1\n*/\nclass B\n"
            )
        }
    )

    assert {m["name"] for m in module(document, "a/F.kt")["members"]} == {"A", "A.Companion", "B"}


REPAIRABLE = [
    "@A\nannotation class U\n",
    "@A\n@B\n@C\nannotation class U\n",
    "@A\nannotation class U()\n",
    "@A\nannotation class U {}\n",
    "@A\nenum class U { X, Y }\n",
]


@pytest.mark.parametrize("source", REPAIRABLE)
def test_a_bare_modifier_class_after_annotations_scans_undamaged(source, run, tmp_path):
    document = run({"a/F.kt": source})
    found = member(document, "a/F.kt", "U")
    twin = member(
        run(
            {
                "a/F.kt": source.replace("annotation class", "public annotation class").replace(
                    "enum class", "public enum class"
                )
            }
        ),
        "a/F.kt",
        "U",
    )

    assert not parse_file(source.encode()).damaged
    assert scan_with_stats(tmp_path, None).damaged == 0
    assert (found["kind"], found["visibility"], found["line"]) == (
        twin["kind"],
        twin["visibility"],
        twin["line"],
    )


def test_a_declaration_on_the_second_line_scans_undamaged(tmp_path):
    build_tree(tmp_path, {"A.kt": "@A\nannotation class U\n"})

    assert scan_with_stats(tmp_path, None).damaged == 0


@pytest.mark.parametrize(
    "source",
    [
        "@A\nconst val K = 1\n",
        '@A\n@B("x")\nconst val K = 1\n',
        "@A\n\nconst val K = 1\n",
        "@A\n// c\nconst val K = 1\n",
        "@A\nconst var K = 1\n",
        "@A\r\nconst val K = 1\r\n",
    ],
)
def test_an_annotated_const_scans_undamaged(tmp_path, source):
    build_tree(tmp_path, {"A.kt": source})

    assert scan_with_stats(tmp_path, None).damaged == 0
    assert not parse_file(source.encode()).damaged


def test_an_annotated_const_matches_its_public_twin(tmp_path):
    def found(source):
        root = tmp_path / str(len(source))
        build_tree(root, {"A.kt": source})
        document = scan(root, None)
        return [
            (m["name"], m["kind"], m["visibility"], m["line"])
            for mod in document["modules"]
            for m in mod["members"]
        ]

    assert found("@A\nconst val K = 1\n") == found("@A\npublic const val K = 1\n")
    assert found("@A\nconst val K = 1\n")[0][:3] == ("K", "constant", "public")


def test_a_repairable_const_does_not_hide_other_damage(run, tmp_path):
    source = "@A\nconst val K = 1\n\n" + DAMAGED_ANNOTATED_OBJECT.replace("K", "O")
    document = run({"a/F.kt": source})
    names = {m["name"] for m in module(document, "a/F.kt")["members"]}

    assert scan_with_stats(tmp_path, None).damaged == 1
    assert {"K", "O"} <= names


def test_unrelated_damage_is_not_hidden_by_the_repair(run, tmp_path):
    source = "@A\nannotation class U\n\n" + DAMAGED_ANNOTATED_OBJECT
    document = run({"a/F.kt": source})
    names = {m["name"] for m in module(document, "a/F.kt")["members"]}

    assert scan_with_stats(tmp_path, None).damaged == 1
    assert {"U", "K"} <= names


def test_the_fixture_use_case_is_a_class_at_line_8():
    document = scan(FIXTURE_ROOT, None)
    found = [
        m for mod in document["modules"] if mod["id"].endswith("UseCase.kt") for m in mod["members"]
    ]

    assert [(m["name"], m["kind"], m["line"]) for m in found] == [("UseCase", "class", 8)]
