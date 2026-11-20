from pathlib import Path

import pytest
import tree_sitter_c_sharp
from conftest import build_tree, csproj, member, without_events
from tree_sitter import Language, Parser

from recognizer_scan_csharp import scan_with_stats
from recognizer_scan_csharp.cli import main

APP = {"App/App.csproj": csproj()}


def damaged_files(tmp_path, source: str) -> tuple[int, dict]:
    build_tree(tmp_path, APP | {"App/A.cs": source})
    result = scan_with_stats(tmp_path, None)

    return result.damaged, result.document


def test_async_used_as_an_identifier_in_an_expression_damages_the_file(tmp_path):
    damaged, _ = damaged_files(
        tmp_path, "namespace N;\npublic class C { int M(int async) { return async ? 1 : 2; } }\n"
    )

    assert damaged == 1


def test_async_as_a_parameter_name_does_not_damage(tmp_path):
    damaged, _ = damaged_files(
        tmp_path, "namespace N;\npublic class C { int M(int async) { return 1; } }\n"
    )

    assert damaged == 0


def test_the_surviving_declarations_of_a_damaged_file_are_kept(tmp_path):
    damaged, document = damaged_files(
        tmp_path,
        "namespace N;\npublic class Before {}\npublic class C { int M(int async) { return async ? 1 : 2; } }\n",
    )

    assert damaged == 1
    assert member(document, "App/A.cs", "Before")["kind"] == "class"


@pytest.mark.parametrize(
    "source",
    [
        "namespace N;\npublic class C : Base,\n#if X\n  IOne,\n#endif\n  ITwo {}\n",
        "namespace N;\npublic class C { object O = new Thing {\n#if X\n  A = 1,\n#endif\n  B = 2 }; }\n",
        "namespace N;\npublic class C { int M() => x\n#if X\n  .A()\n#endif\n  .B(); }\n",
    ],
    ids=["base-list", "initializer", "method-chain"],
)
def test_a_preprocessor_directive_inside_a_list_or_chain_damages(tmp_path, source):
    damaged, _ = damaged_files(tmp_path, source)

    assert damaged == 1


def test_a_preprocessor_directive_between_members_does_not_damage(tmp_path):
    damaged, document = damaged_files(
        tmp_path,
        "namespace N;\npublic class C {\n#if X\n  public int A;\n#endif\n  public int B;\n}\n",
    )

    assert damaged == 0
    assert member(document, "App/A.cs", "C")["kind"] == "class"


def test_a_type_inside_a_conditional_block_is_kept(tmp_path):
    damaged, document = damaged_files(
        tmp_path, "namespace N;\n#if X\npublic class Guarded {}\n#endif\n"
    )

    assert damaged == 0
    assert member(document, "App/A.cs", "Guarded")["kind"] == "class"


def test_the_cli_prints_the_damaged_line_and_exits_zero(tmp_path, capsys):
    build_tree(
        tmp_path,
        APP
        | {
            "App/A.cs": "namespace N;\npublic class C { int M(int async) { return async ? 1 : 2; } }\n",
            "App/B.cs": "namespace N;\npublic class B {}\n",
        },
    )
    code = main(["run", str(tmp_path), "--output", str(tmp_path / "out.json")])

    assert code == 0
    assert (
        without_events(capsys.readouterr().err)
        == "recognizer-scan-csharp: 1 of 2 files had damaged spans\n"
    )


def test_three_fs_and_one_vb_file_print_the_left_out_line(tmp_path, capsys):
    build_tree(
        tmp_path,
        {"A.cs": "class A {}\n", "a.fs": "", "b.fs": "", "sub/c.fs": "", "d.vb": ""},
    )
    main(["run", str(tmp_path), "--output", str(tmp_path / "out.json")])

    assert (
        without_events(capsys.readouterr().err)
        == "recognizer-scan-csharp: left out 3 .fs and 1 .vb files\n"
    )


def test_no_left_out_files_print_no_line(tmp_path, capsys):
    build_tree(tmp_path, {"A.cs": "class A {}\n"})
    main(["run", str(tmp_path), "--output", str(tmp_path / "out.json")])

    assert without_events(capsys.readouterr().err) == ""


def test_a_repository_with_no_cs_file_is_not_an_error(tmp_path, capsys):
    build_tree(tmp_path, {"README.md": "x"})
    code = main(["run", str(tmp_path), "--output", str(tmp_path / "out.json")])

    assert code == 0
    assert (tmp_path / "out.json").read_text().count('"modules": []') == 1


def test_the_parsed_grammar_is_the_pinned_one_not_pypis_0_23_5():
    parser = Parser(Language(tree_sitter_c_sharp.language()))
    tree = parser.parse(
        b"static class E { extension(string s) { public int Len() => s.Length; } }\n"
    )
    seen = []
    pending = [tree.root_node]

    while pending:
        node = pending.pop()
        seen.append(node.type)
        pending.extend(node.children)

    assert "ERROR" not in seen
    assert "extension_declaration" in seen
    assert "constructor_declaration" not in seen


def test_the_grammar_is_installed_from_the_pinned_git_commit():
    from importlib.metadata import distribution

    direct_url = distribution("tree-sitter-c-sharp").read_text("direct_url.json")

    assert direct_url is not None
    assert "f1c7c1ee21f56a33412c12efb8abe0c483f05f0d" in direct_url


def test_the_lockfile_records_the_grammar_as_a_git_source_at_the_pin():
    lock = (Path(__file__).parents[1] / "uv.lock").read_text()

    assert "tree-sitter-c-sharp?rev=f1c7c1ee21f56a33412c12efb8abe0c483f05f0d" in lock


def test_the_pyproject_carries_the_binding_dependencies():
    text = (Path(__file__).parents[1] / "pyproject.toml").read_text()

    assert 'dependencies = ["tree-sitter==0.26.0", "tree-sitter-c-sharp==0.23.5"]' in text
    assert (
        'tree-sitter-c-sharp = { git = "https://github.com/tree-sitter/tree-sitter-c-sharp", '
        'rev = "f1c7c1ee21f56a33412c12efb8abe0c483f05f0d" }'
    ) in text
