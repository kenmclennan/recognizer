import json
import tempfile
from pathlib import Path

from conftest import (
    EXPECTED_SCAN,
    FIXTURE_ROOT,
    REPOSITORY,
    build_tree,
    csproj,
    edges_of,
    local_targets,
    validate,
)

from recognizer_scan_csharp import scan
from recognizer_scan_csharp.cli import render

MARKUP_ROOT = REPOSITORY / "fixtures" / "csharp" / "markup-sample"
MARKUP_EXPECTED = REPOSITORY / "fixtures" / "csharp" / "markup-expected-scan.json"
WEB = {"App/App.csproj": csproj("Microsoft.NET.Sdk.Web", {"RootNamespace": "App"})}
PLAIN = {"App/App.csproj": csproj(properties={"RootNamespace": "App"})}
HOST = "App/Host.cs"


def klass(namespace: str, name: str, modifier: str = "public") -> str:
    return f"namespace {namespace};\n{modifier} class {name} {{ }}\n"


def host() -> dict[str, str]:
    return {"App/Host.cs": klass("App", "Host")}


def razor_edges(document: dict, source: str = "App/Host.cs") -> dict[str, tuple]:
    return {e["to"]: (e["line"], tuple(e["names"])) for e in edges_of(document, source, "depends")}


def basket() -> dict[str, str]:
    return {"App/Models/Basket.cs": klass("App.Models", "Basket")}


def test_inject_model_and_inherits_resolve_simple_qualified_and_generic_names(run):
    files = (
        WEB
        | host()
        | basket()
        | {
            "App/Services/Svc.cs": klass("App.Services", "Svc"),
            "App/Models/Base.cs": klass("App.Models", "Base"),
            "App/A.razor": "@using App.Services\n@inject Svc s\n",
            "App/B.cshtml": "@model App.Models.Basket\n",
            "App/C.razor": "@using App.Models\n@inherits Base\n",
            "App/D.razor": "@using System.Collections.Generic\n@using App.Models\n@inject IList<Basket> items\n",
        }
    )
    document = run(files)
    found = razor_edges(document)

    assert found["App/Services/Svc.cs"] == (2, ("Svc",))
    assert found["App/Models/Base.cs"] == (2, ("Base",))
    assert found["App/Models/Basket.cs"] == (1, ("Basket",))


def test_a_generic_argument_is_resolved_and_the_generic_head_is_not_an_edge(run):
    document = run(
        WEB
        | host()
        | basket()
        | {"App/D.razor": "@using App.Models\n@inject IList<Basket> items\n"}
    )

    assert set(razor_edges(document)) == {"App/Models/Basket.cs"}


def test_using_makes_no_edge_by_itself_and_supports_static_and_alias(run):
    document = run(
        WEB
        | host()
        | basket()
        | {
            "App/Util.cs": "namespace App.Lib;\npublic static class Util { public static int Twice(int x) => x; }\n",
            "App/Only.razor": "@using App.Models\n",
            "App/Alias.cshtml": "@using B = App.Models.Basket\n@model B\n",
        }
    )

    assert razor_edges(document) == {"App/Models/Basket.cs": (2, ("Basket",))}


def test_imports_files_apply_to_their_folder_and_below_only(run):
    files = (
        WEB
        | host()
        | basket()
        | {
            "App/Pages/_Imports.razor": "@using App.Models\n",
            "App/Pages/Deep/Use.razor": "@inherits Basket\n",
            "App/Other/Use.razor": "@inherits Basket\n",
            "App/Views/_ViewImports.cshtml": "@using App.Models\n",
            "App/Views/Use.cshtml": "@model Basket\n",
        }
    )
    document = run(files)

    assert razor_edges(document)["App/Models/Basket.cs"][1] == ("Basket",)
    assert [e["line"] for e in edges_of(document, HOST)] == [1]
    assert len(edges_of(document, HOST)) == 1


def test_an_imports_file_inject_hangs_on_its_own_source_and_is_not_inherited(run):
    files = WEB | {
        "App/Pages/Own.cs": klass("App.Pages", "Own"),
        "App/Models/Basket.cs": klass("App.Models", "Basket"),
        "App/Models/Zed.cs": klass("App.Models", "Zed"),
        "App/Pages/_Imports.razor": "@using App.Models\n@inject Basket b\n",
        "App/Pages/Deep/Use.razor": "<p>none</p>\n",
    }
    document = run(files)

    assert local_targets(document, "App/Pages/Own.cs") == {"App/Models/Basket.cs": ["Basket"]}
    assert not edges_of(document, "App/Models/Zed.cs")


def test_component_tags_resolve_plain_qualified_and_alias_forms(run):
    files = (
        WEB
        | host()
        | {
            "App/Comp/Plain.cs": klass("App.Comp", "Plain"),
            "App/Comp/Qual.cs": klass("App.Comp", "Qual"),
            "App/Comp/Als.cs": klass("App.Comp", "Als"),
            "App/Page.razor": (
                "@using App.Comp\n@using C = App.Comp\n<Plain />\n<App.Comp.Qual />\n<C.Als />\n"
                "<div>x</div>\n<span></span>\n"
            ),
        }
    )
    document = run(files)

    assert razor_edges(document) == {
        "App/Comp/Plain.cs": (3, ("Plain",)),
        "App/Comp/Qual.cs": (4, ("Qual",)),
        "App/Comp/Als.cs": (5, ("Als",)),
    }


def test_a_component_declared_only_in_a_razor_file_and_cshtml_tags_make_no_edge(run):
    files = (
        WEB
        | host()
        | {
            "App/Comp/Plain.cs": klass("App.Comp", "Plain"),
            "App/Comp/Only.razor": "<p>only</p>\n",
            "App/Page.razor": "@using App.Comp\n<Only />\n",
            "App/View.cshtml": "@using App.Comp\n<Plain />\n",
        }
    )

    assert not edges_of(run(files), HOST)


def test_xaml_mappings_elements_and_data_types_resolve(run):
    files = PLAIN | {
        "App/Main.xaml.cs": klass("App", "Main"),
        "App/Vm/Item.cs": klass("App.Vm", "Item"),
        "App/Vm/Row.cs": klass("App.Vm", "Row"),
        "App/Vm/Cell.cs": klass("App.Vm", "Cell"),
        "App/Vm/Col.cs": klass("App.Vm", "Col"),
        "App/Vm/Dot.cs": klass("App.Vm", "Dot"),
        "App/Main.xaml": (
            '<Page xmlns:a="clr-namespace:App.Vm"\n'
            '      xmlns:b="clr-namespace:App.Vm;assembly=App"\n'
            '      xmlns:c="using:App.Vm"\n'
            '      xmlns:u="http://schemas.example/x"\n'
            '      x:DataType="a:Item" x:Class="App.Main">\n'
            "  <a:Row />\n"
            "  <b:Cell.Content />\n"
            "  <c:Col />\n"
            '  <Grid x:DataType="App.Vm.Dot" Tag="{x:Static a:Item}" Extra="x:DataType=&quot;{Binding}&quot;" />\n'
            "  <u:Ignored /><z:Nope />\n"
            "</Page>\n"
        ),
    }
    found = razor_edges(run(files), "App/Main.xaml.cs")

    assert set(found) == {f"App/Vm/{n}.cs" for n in ("Item", "Row", "Cell", "Col", "Dot")}
    assert found["App/Vm/Item.cs"][0] == 5
    assert found["App/Vm/Dot.cs"][0] == 9


def test_xaml_class_adds_an_edge_only_when_it_resolves_to_a_different_module(run):
    files = PLAIN | {
        "App/Main.xaml.cs": klass("App", "Main"),
        "App/Other.cs": klass("App", "Other"),
        "App/Main.xaml": '<Page x:Class="App.Other" />\n',
        "App/Self.xaml.cs": klass("App", "Self"),
        "App/Self.xaml": '<Page x:Class="App.Self" />\n',
    }
    document = run(files)

    assert razor_edges(document, "App/Main.xaml.cs") == {"App/Other.cs": (1, ("Other",))}
    assert not edges_of(document, "App/Self.xaml.cs")


def test_a_data_type_that_is_a_markup_extension_is_not_read(run):
    files = PLAIN | {
        "App/Main.xaml.cs": klass("App", "Main"),
        "App/Item.cs": klass("App", "Item"),
        "App/Main.xaml": '<Page xmlns:a="clr-namespace:App" x:DataType="{x:Type a:Item}" />\n',
    }

    assert not edges_of(run(files), "App/Main.xaml.cs")


def test_names_inside_comments_make_no_edge_and_lines_hold_after_a_multiline_comment(run):
    files = (
        WEB
        | host()
        | basket()
        | {
            "App/Models/Late.cs": klass("App.Models", "Late"),
            "App/A.razor": ("@using App.Models\n@* @inject Basket b\nmore *@\n@inject Late l\n"),
        }
    )
    found = razor_edges(run(files))

    assert found == {"App/Models/Late.cs": (4, ("Late",))}

    files = PLAIN | {
        "App/Main.xaml.cs": klass("App", "Main"),
        "App/Item.cs": klass("App", "Item"),
        "App/Main.xaml": (
            '<!-- <a:Item xmlns:a="clr-namespace:App" /> -->\n'
            '<!--\n multi\n-->\n<Page xmlns:a="clr-namespace:App">\n<a:Item />\n</Page>\n'
        ),
    }

    assert razor_edges(run(files), "App/Main.xaml.cs") == {"App/Item.cs": (6, ("Item",))}


def source_of(files: dict[str, str]) -> str | None:
    document = run_scan(files)
    sources = {e["from"] for e in document["edges"] if e["to"] == "App/Models/Basket.cs"}

    return next(iter(sources), None)


def run_scan(files: dict[str, str]) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        build_tree(Path(directory), files)
        document = scan(Path(directory), None)
        validate(document)

        return document


def test_source_module_prefers_the_code_behind(run):
    files = (
        WEB
        | basket()
        | {
            "App/A.cs": klass("App", "A"),
            "App/Page.razor.cs": klass("App", "PageModel"),
            "App/Page.razor": "@inject App.Models.Basket b\n",
        }
    )

    assert razor_edges(run(files), "App/Page.razor.cs")["App/Models/Basket.cs"][0] == 1


def test_the_nearest_module_in_the_same_directory_wins_with_a_lexicographic_tie_break():
    files = (
        WEB
        | basket()
        | {
            "App/Views/Zed.cs": klass("App.Views", "Zed"),
            "App/Views/Helper.cs": klass("App.Views", "Helper"),
            "App/Views/Main.xaml.cs": klass("App.Views", "Main"),
            "App/Views/Index.cshtml": "@model App.Models.Basket\n",
        }
    )

    assert source_of(files) == "App/Views/Helper.cs"


def test_the_walk_goes_up_one_and_two_directories_and_stops_at_the_project_directory():
    base = WEB | basket()
    one = base | {
        "App/Views/Deep/Index.cshtml": "@model App.Models.Basket\n",
        "App/Views/V.cs": klass("A", "V"),
    }
    two = base | {
        "App/Views/Deep/Index.cshtml": "@model App.Models.Basket\n",
        "App/R.cs": klass("A", "R"),
    }
    sibling = WEB | {
        "App/Models/Basket.cs": klass("App.Models", "Basket"),
        "App/Other/O.cs": klass("A", "O"),
        "App/Views/Index.cshtml": "@model App.Models.Basket\n",
    }

    assert source_of(one) == "App/Views/V.cs"
    assert source_of(two) == "App/R.cs"
    assert source_of(sibling) is None


def test_global_usings_and_declaration_free_files_are_never_a_source_and_program_is():
    files = (
        WEB
        | basket()
        | {
            "App/GlobalUsings.cs": "global using System;\n",
            "App/AssemblyInfo.cs": '[assembly: System.Reflection.AssemblyTitle("x")]\n',
            "App/Program.cs": "System.Console.WriteLine(1);\n",
            "App/Views/Index.cshtml": "@model App.Models.Basket\n",
        }
    )

    assert source_of(files) == "App/Program.cs"


def test_markup_with_no_owning_project_or_no_candidate_adds_no_edge_but_is_listed(tmp_path):
    build_tree(
        tmp_path,
        {
            "Free/Models/Basket.cs": klass("Free.Models", "Basket"),
            "Free/Index.cshtml": "@model Free.Models.Basket\n",
            "App/App.csproj": csproj(),
            "App/Index.razor": "@inject Free.Models.Basket b\n",
        },
    )
    document = scan(tmp_path, None)
    listed = [f["path"] for f in document["files"]]

    assert not document["edges"]
    assert "Free/Index.cshtml" in listed and "App/Index.razor" in listed


def test_an_internal_type_in_another_project_is_not_reached_and_a_referenced_public_one_is(run):
    files = {
        "Lib/Lib.csproj": csproj(properties={"RootNamespace": "Lib"}),
        "Lib/Hidden.cs": klass("Lib", "Hidden", "internal"),
        "Lib/Shown.cs": klass("Lib", "Shown"),
        "App/App.csproj": csproj(
            "Microsoft.NET.Sdk.Web", {"RootNamespace": "App"}, references=("../Lib/Lib.csproj",)
        ),
        "App/Host.cs": klass("App", "Host"),
        "App/Index.cshtml": "@model Lib.Hidden\n@model Lib.Shown\n",
    }
    found = razor_edges(run(files))

    assert set(found) == {"Lib/Shown.cs"}


def test_a_mixed_markup_file_yields_exactly_the_resolved_edge_and_no_foreign_or_unresolved(
    tmp_path,
):
    tree = (
        WEB
        | host()
        | {
            "App/Ok.cs": klass("App", "Ok"),
            "Lib/Lib.csproj": csproj(properties={"RootNamespace": "Lib"}),
            "Lib/Hidden.cs": klass("Lib", "Hidden", "internal"),
        }
    )
    build_tree(tmp_path, tree)
    before = scan(tmp_path, None)
    build_tree(
        tmp_path,
        {
            "App/Page.xaml": '<ContentPage xmlns:x1="clr-namespace:App" xmlns:x2="clr-namespace:Lib">\n<x1:Ok /><x2:Hidden />\n</ContentPage>\n'
        },
    )
    after = scan(tmp_path, None)

    assert razor_edges(after) == {"App/Ok.cs": (2, ("Ok",))}
    assert after["foreign"] == before["foreign"]
    assert after["unresolved_imports"] == before["unresolved_imports"]


def test_a_pair_from_both_cs_and_markup_is_one_edge_with_the_cs_line_and_names_unioned(run):
    files = (
        WEB
        | basket()
        | {
            "App/Page.razor.cs": "namespace App;\npublic partial class Page {\n  App.Models.Basket b;\n}\n",
            "App/Page.razor": "@using App.Models\n\n\n\n\n@inject Basket b\n",
        }
    )
    edges = edges_of(run(files), "App/Page.razor.cs")

    assert edges == [
        {
            "from": "App/Page.razor.cs",
            "to": "App/Models/Basket.cs",
            "kind": "depends",
            "line": 3,
            "names": ["Basket"],
        }
    ]


def test_scans_are_deterministic_and_the_markup_fixture_matches_its_expected_file():
    first = scan(MARKUP_ROOT, None)
    second = scan(MARKUP_ROOT, None)

    assert first == second
    assert render(first) == MARKUP_EXPECTED.read_text()
    validate(first)


def test_the_markup_fixture_edges_match_the_worked_example():
    document = scan(MARKUP_ROOT, None)
    pairs = {(e["from"], e["to"]) for e in document["edges"]}
    paths = [f["path"] for f in document["files"]]

    assert pairs == {
        ("Shop/Pages/Cart.razor.cs", "Shop/Services/CartService.cs"),
        ("Shop/Pages/Cart.razor.cs", "Shop/Pages/Totals.cs"),
        ("Shop/Views/Main.xaml.cs", "Shop/Models/Basket.cs"),
        ("Shop/Views/Main.xaml.cs", "Shop/Models/Receipt.cs"),
        ("Shop/Views/Helper.cs", "Shop/Models/Basket.cs"),
    }
    assert "Shop.Tests/Skipped.razor" not in paths
    assert "Shop/Views/Main.xaml" in paths
    assert not any(m["id"].endswith((".razor", ".cshtml", ".xaml")) for m in document["modules"])


def test_a_tree_with_no_markup_differs_from_the_base_scan_only_in_the_selection_extensions():
    document = scan(FIXTURE_ROOT, None)
    wanted = json.loads(EXPECTED_SCAN.read_text())

    assert document["selection"]["extensions"] == [".cs", ".razor", ".cshtml", ".xaml"]
    wanted["scanner"]["version"] = document["scanner"]["version"]
    assert document == wanted


def test_markup_under_a_test_project_bin_or_obj_is_not_read(run):
    files = (
        WEB
        | host()
        | {
            "Tests/T.csproj": csproj(packages=("xunit",)),
            "Tests/A.razor": "@inject App.Host h\n",
            "App/bin/B.razor": "@inject App.Host h\n",
            "App/obj/C.cshtml": "@model App.Host\n",
        }
    )
    listed = [f["path"] for f in run(files)["files"]]

    assert not [p for p in listed if p.endswith((".razor", ".cshtml"))]


def test_editing_a_markup_file_changes_its_hash(tmp_path):
    build_tree(tmp_path, WEB | host() | {"App/A.razor": "<p>1</p>\n"})
    first = {f["path"]: f["hash"] for f in scan(tmp_path, None)["files"]}
    build_tree(tmp_path, {"App/A.razor": "<p>2</p>\n"})
    second = {f["path"]: f["hash"] for f in scan(tmp_path, None)["files"]}

    assert first["App/A.razor"] != second["App/A.razor"]
    assert first["App/Host.cs"] == second["App/Host.cs"]
