import tree_sitter_kotlin
from conftest import FIXTURE_ROOT, build_tree, member, module
from tree_sitter import Language, Parser

from recognizer_scan_kotlin import scan_with_stats
from recognizer_scan_kotlin.cli import main

PARSER = Parser(Language(tree_sitter_kotlin.language()))
STACKED = FIXTURE_ROOT / "app/src/main/kotlin/shop/application/UseCase.kt"
ONE_LINE = FIXTURE_ROOT / "app/src/main/kotlin/shop/domain/Currency.kt"


def top_level_types(path) -> list[str]:
    return [c.type for c in PARSER.parse(path.read_bytes()).root_node.children]


def test_precondition_stacked_annotations_misparse_to_an_annotated_expression():
    types = top_level_types(STACKED)

    assert "annotated_expression" in types
    assert "class_declaration" not in types


def test_precondition_a_one_line_companion_parses_with_an_error_node():
    assert PARSER.parse(ONE_LINE.read_bytes()).root_node.has_error


def test_a_misparsed_declaration_is_recovered_as_a_member_with_its_visibility(run):
    document = run(
        {
            "a/UseCase.kt": (
                "package p\n\n@Target(AnnotationTarget.CLASS)\n@Retention(AnnotationRetention.RUNTIME)\n"
                "@Singleton\nprivate annotation class UseCase\n"
            )
        }
    )
    found = member(document, "a", "UseCase")

    assert (found["kind"], found["visibility"], found["exported"]) == ("class", "private", False)


def test_a_damaged_file_keeps_the_names_found_by_pattern(run):
    document = run(
        {
            "a/F.kt": (
                "package p\n\n"
                "class A { companion object { const val K = 1 } }\n\n"
                "internal interface B\n\n"
                "fun helper(x: Int) = x\n"
            )
        }
    )
    names = {m["name"]: (m["kind"], m["visibility"]) for m in module(document, "a")["members"]}

    assert names == {
        "A": ("class", "public"),
        "A.Companion": ("class", "public"),
        "B": ("interface", "internal"),
        "helper": ("function", "public"),
    }
    assert "methods" not in member(document, "a", "A")


def test_a_damaged_span_in_a_good_declaration_keeps_the_others_outlines(run):
    document = run(
        {
            "a/F.kt": (
                "package p\n\n"
                "class Good(val x: Int) {\n    fun f() = 1\n}\n\n"
                "class A { companion object { const val K = 1 } }\n"
            )
        }
    )

    assert [m["name"] for m in member(document, "a", "Good")["methods"]] == ["f"]


def test_a_damaged_body_makes_no_calls(run):
    document = run(
        {
            "a/F.kt": (
                "package p\n\n"
                "fun target() = 1\n\n"
                "class A { companion object { fun f() { target() } } }\n"
            )
        }
    )

    assert document["calls"] == []


def test_the_damaged_count_is_reported_for_the_fixture():
    result = scan_with_stats(FIXTURE_ROOT, None)

    assert (result.damaged, result.total) == (2, 11)


def test_the_cli_prints_one_stderr_line_when_files_are_damaged(tmp_path, capsys):
    build_tree(
        tmp_path,
        {"A.kt": "class A { companion object { const val K = 1 } }\n", "B.kt": "class B\n"},
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

    assert {m["name"] for m in module(document, "a")["members"]} == {"A", "A.Companion", "B"}
