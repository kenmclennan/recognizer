import pytest
from conftest import csproj, local_targets, targets

LIB = "Lib/Lib.csproj"
EXTENSION = "namespace Lib.Ext;\npublic static class Texts { public static string Shout(this string s) => s; }\n"


def tree(
    use: str,
    reference: bool = True,
    extension: str = EXTENSION,
    using: str = "using Lib.Ext;\n",
) -> dict[str, str]:
    return {
        LIB: csproj(),
        "Lib/Texts.cs": extension,
        "App/App.csproj": csproj(references=("..\\Lib\\Lib.csproj",) if reference else ()),
        "App/Use.cs": f"{using}namespace App;\npublic class Use {{ string V(string x) {use} }}\n",
    }


def test_a_call_on_a_value_is_an_edge_to_the_declaring_file(run):
    document = run(tree("=> x.Shout();"))

    assert local_targets(document, "App/Use.cs") == {"Lib/Texts.cs": ["Shout"]}


def test_a_null_conditional_call_is_an_edge_too(run):
    document = run(tree("=> x?.Shout();"))

    assert local_targets(document, "App/Use.cs") == {"Lib/Texts.cs": ["Shout"]}


def test_a_generic_call_is_an_edge(run):
    document = run(tree("=> x.Shout<string>();"))

    assert local_targets(document, "App/Use.cs") == {"Lib/Texts.cs": ["Shout"]}


def test_a_call_whose_namespace_is_not_visible_makes_no_edge(run):
    document = run(tree("=> x.Shout();", using=""))

    assert local_targets(document, "App/Use.cs") == {}


def test_a_call_to_an_internal_extension_makes_no_edge_across_projects(run):
    internal = EXTENSION.replace("public static class", "internal static class")
    document = run(tree("=> x.Shout();", extension=internal))

    assert local_targets(document, "App/Use.cs") == {}


def test_a_call_from_a_project_that_does_not_reach_the_extension_makes_no_edge(run):
    document = run(tree("=> x.Shout();", reference=False))

    assert local_targets(document, "App/Use.cs") == {}


def test_there_is_no_fallback_to_every_candidate_when_none_is_reachable(run):
    files = tree("=> x.Shout();", reference=False)
    files["Other/Other.csproj"] = csproj()
    files["Other/More.cs"] = EXTENSION.replace("Texts", "More")
    document = run(files)

    assert local_targets(document, "App/Use.cs") == {}


def test_an_extension_in_the_same_namespace_needs_no_using(run):
    files = tree("=> x.Shout();", using="")
    files["App/Use.cs"] = files["App/Use.cs"].replace("namespace App;", "namespace Lib.Ext;")
    document = run(files)

    assert local_targets(document, "App/Use.cs") == {"Lib/Texts.cs": ["Shout"]}


def test_a_csharp_14_extension_block_member_is_indexed(run):
    block = (
        "namespace Lib.Ext;\npublic static class Texts {\n"
        "  extension(string s) { public int Size() => s.Length; public string Label => s; }\n}\n"
    )
    document = run(tree("=> x.Size();", extension=block))

    assert local_targets(document, "App/Use.cs") == {"Lib/Texts.cs": ["Size"]}


def test_a_private_extension_is_not_indexed(run):
    private = EXTENSION.replace("public static string", "private static string")
    document = run(tree("=> x.Shout();", extension=private))

    assert local_targets(document, "App/Use.cs") == {}


def test_a_method_without_this_is_not_an_extension(run):
    plain = EXTENSION.replace("this string s", "string s")
    document = run(tree("=> x.Shout();", extension=plain))

    assert local_targets(document, "App/Use.cs") == {}


def test_an_instance_method_that_wins_still_makes_the_edge(run):
    files = tree("=> x.Shout();")
    files["App/Own.cs"] = 'namespace App;\npublic class Own { public string Shout() => ""; }\n'
    files["App/Use.cs"] = (
        files["App/Use.cs"]
        .replace("string x", "Own x")
        .replace("string V(Own x)", "string V(Own x)")
    )
    document = run(files)

    assert "Lib/Texts.cs" in targets(document, "App/Use.cs")


@pytest.mark.parametrize("name", ["Shout", "Missing"])
def test_matching_is_by_name_only(run, name):
    document = run(tree(f"=> x.{name}();"))

    assert bool(local_targets(document, "App/Use.cs")) == (name == "Shout")
