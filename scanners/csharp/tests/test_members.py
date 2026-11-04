import pytest
from conftest import csproj, member, module, module_ids

APP = {"App/App.csproj": csproj()}


def one(run, source: str, path: str = "App/A.cs") -> dict:
    return run(APP | {path: source})


def test_each_type_kind_maps_to_its_member_kind(run):
    source = (
        "namespace N;\n"
        "public class C {}\npublic sealed class S {}\npublic static class T {}\n"
        "public partial class P {}\npublic record R(int X);\npublic record struct RS(int X);\n"
        "public struct St {}\npublic enum E { A }\npublic interface I {}\n"
        "public delegate void D();\n"
    )
    document = one(run, source)
    kinds = {m["name"]: m["kind"] for m in module(document, "App/A.cs")["members"]}

    assert kinds == {
        "C": "class",
        "S": "class",
        "T": "class",
        "P": "class",
        "R": "class",
        "RS": "class",
        "St": "class",
        "E": "class",
        "I": "interface",
    }


def test_delegates_and_using_aliases_are_not_members(run):
    document = one(run, "using X = System.String;\nnamespace N;\npublic delegate void D();\n")

    assert module(document, "App/A.cs")["members"] == []


@pytest.mark.parametrize(
    ("declaration", "visibility", "exported"),
    [
        ("public class C {}", "public", True),
        ("internal class C {}", "internal", True),
        ("class C {}", "internal", True),
        ("file class C {}", "private", False),
    ],
)
def test_a_top_level_type_records_its_visibility(run, declaration, visibility, exported):
    member_ = member(one(run, f"namespace N;\n{declaration}\n"), "App/A.cs", "C")

    assert member_["visibility"] == visibility
    assert member_["exported"] is exported


def test_abstract_classes_and_records_carry_the_abstract_tag_and_interfaces_do_not(run):
    document = one(
        run,
        "namespace N;\npublic abstract class A {}\npublic abstract record B;\n"
        "public class C {}\npublic interface I {}\n",
    )

    assert member(document, "App/A.cs", "A")["tags"] == ["abstract"]
    assert member(document, "App/A.cs", "B")["tags"] == ["abstract"]
    assert "tags" not in member(document, "App/A.cs", "C")
    assert "tags" not in member(document, "App/A.cs", "I")


def test_methods_fields_and_bases_are_outlined(run):
    document = one(
        run,
        "namespace N;\npublic class C : Base, IThing {\n"
        "  private int count;\n  public string Name { get; }\n"
        "  public static async Task<int> Run(int a, string b) => 1;\n"
        "  public C(int a) {}\n}\n",
    )
    outline = member(document, "App/A.cs", "C")

    assert outline["bases"] == ["Base", "IThing"]
    assert [(f["name"], f["private"]) for f in outline["fields"]] == [
        ("count", True),
        ("Name", False),
    ]
    run_method = next(m for m in outline["methods"] if m["name"] == "Run")

    assert run_method["params"] == [{"name": "a", "type": "int"}, {"name": "b", "type": "string"}]
    assert run_method["returns"] == "Task<int>"
    assert run_method["tags"] == ["static", "async"]


def test_interface_methods_without_a_body_are_abstract(run):
    document = one(run, "namespace N;\npublic interface I { void Do(); }\n")

    assert member(document, "App/A.cs", "I")["methods"][0]["tags"] == ["abstract"]


def test_a_records_positional_parameters_are_ordinary_depends_edges_with_no_label(run):
    document = run(
        APP
        | {
            "App/Dep.cs": "namespace D;\npublic class Dep {}\n",
            "App/Rec.cs": "using D;\nnamespace N;\npublic record Rec(Dep Dep, int X);\n",
        }
    )
    edges = [e for e in document["edges"] if e["from"] == "App/Rec.cs"]

    assert [(e["to"], e["kind"]) for e in edges] == [("App/Dep.cs", "depends")]
    assert not any({"label", "injection"} & set(e) for e in document["edges"])


def entry(document: dict, path: str) -> bool:
    return bool(module(document, path).get("entry_point"))


@pytest.mark.parametrize(
    "source",
    [
        "var x = 1;\nSystem.Console.WriteLine(x);\n",
        "namespace N;\npublic class P { public static void Main() {} }\n",
        "namespace N;\npublic class C : ControllerBase {}\n",
        "namespace N;\npublic class C : Controller {}\n",
        "namespace N;\n[ApiController] public class C {}\n",
        "namespace N;\npublic class C : BackgroundService {}\n",
        "namespace N;\npublic class C : IHostedService {}\n",
        "namespace N;\n[Generator] public class C {}\n",
        'namespace N;\n[DiagnosticAnalyzer("C#")] public class C {}\n',
        'namespace N;\n[ExportCodeFixProvider("x")] public class C {}\n',
        'namespace N;\n[ExportCodeRefactoringProvider("x")] public class C {}\n',
        'namespace N;\n[Cmdlet("Get", "X")] public class C {}\n',
        "namespace N;\n[DbContext(typeof(Ctx))] public class C {}\n",
        'namespace N;\n[Migration("1")] public class C {}\n',
        "namespace N;\npublic class C : Migration {}\n",
        "namespace N;\npublic class C : ModelSnapshot {}\n",
        "namespace N;\npublic class C : IIncrementalGenerator {}\n",
        "namespace N;\npublic class C : ISourceGenerator {}\n",
        "namespace N;\npublic class C : DiagnosticAnalyzer {}\n",
        "namespace N;\npublic class C : CodeFixProvider {}\n",
        "namespace N;\npublic class C : Cmdlet {}\n",
        "namespace N;\npublic class C : PSCmdlet {}\n",
    ],
)
def test_each_entry_point_rule_marks_the_module(run, source):
    assert entry(one(run, source), "App/A.cs")


@pytest.mark.parametrize("suffix", [".xaml.cs", ".razor.cs", ".cshtml.cs"])
def test_code_behind_files_are_entry_points(run, suffix):
    path = f"App/Page{suffix}"

    assert entry(one(run, "namespace N;\npublic partial class Page {}\n", path), path)


def test_an_ordinary_class_is_not_an_entry_point(run):
    assert not entry(one(run, "namespace N;\npublic class C {}\n"), "App/A.cs")


def test_a_main_that_is_not_static_is_not_an_entry_point(run):
    assert not entry(
        one(run, "namespace N;\npublic class C { public void Main() {} }\n"), "App/A.cs"
    )


CONTRACT = "namespace N;\npublic interface IHandler<T> {}\n"
HANDLER = "namespace N;\npublic class H : IHandler<int> {}\n"


@pytest.mark.parametrize(
    "root",
    [
        "var t = All().Where(x => typeof(IHandler<>).IsAssignableFrom(x));",
        "var t = c.GetTypesToRegister(typeof(IHandler<>), assemblies);",
        "var t = c.GetTypesToRegister<IHandler<int>>(assemblies);",
        "c.Register(typeof(IHandler<>), assemblies);",
        "c.Collection.Register(typeof(IHandler<>), assemblies);",
        "c.Collection.Append(typeof(IHandler<>), assemblies);",
        "c.RegisterDecorator(typeof(IHandler<>), typeof(Dec<>), assemblies);",
    ],
)
def test_each_convention_root_pattern_marks_the_registered_types(run, root):
    document = run(
        APP
        | {
            "App/Contract.cs": CONTRACT,
            "App/H.cs": HANDLER,
            "App/Root.cs": f"namespace N;\npublic class Root {{ void M() {{ {root} }} }}\n",
        }
    )

    assert entry(document, "App/H.cs")
    assert not entry(document, "App/Contract.cs")


def test_an_open_generic_register_without_an_assembly_argument_is_not_a_root(run):
    document = run(
        APP
        | {
            "App/Contract.cs": CONTRACT,
            "App/H.cs": HANDLER,
            "App/Root.cs": "namespace N;\npublic class Root { void M() { c.Register(typeof(IHandler<>), typeof(H)); } }\n",
        }
    )

    assert not entry(document, "App/H.cs")


def test_a_registered_type_the_repository_does_not_declare_is_not_a_root(run):
    document = run(
        APP
        | {
            "App/H.cs": "namespace N;\npublic class H : IForeign<int> {}\n",
            "App/Root.cs": "namespace N;\npublic class Root { void M() { c.Register(typeof(IForeign<>), assemblies); } }\n",
        }
    )

    assert not entry(document, "App/H.cs")


def test_mediatr_handlers_are_roots_where_add_mediatr_appears(run):
    files = APP | {
        "App/H.cs": "namespace N;\npublic class H : IRequestHandler<int, int> {}\n",
        "App/Root.cs": "namespace N;\npublic class Root { void M(S s) { s.AddMediatR(x => {}); } }\n",
    }

    assert entry(run(files), "App/H.cs")


def test_mediatr_handlers_are_not_roots_without_add_mediatr(run):
    files = APP | {"App/H.cs": "namespace N;\npublic class H : IRequestHandler<int, int> {}\n"}

    assert not entry(run(files), "App/H.cs")


def test_fluent_validators_are_roots_where_add_validators_from_assembly_appears(run):
    files = APP | {
        "App/V.cs": "namespace N;\npublic class V : AbstractValidator<int> {}\n",
        "App/Root.cs": "namespace N;\npublic class Root { void M(S s) { s.AddValidatorsFromAssemblyContaining<V>(); } }\n",
    }

    assert entry(run(files), "App/V.cs")


def test_a_file_declaring_no_type_has_no_members(run):
    document = run(APP | {"App/GlobalUsings.cs": "global using System;\n"})

    assert module_ids(document) == ["App/GlobalUsings.cs"]
    assert module(document, "App/GlobalUsings.cs")["members"] == []


def test_end_line_for_method_constructor_and_expression_bodied_member(run):
    document = one(
        run,
        "namespace N;\n"
        "public class C {\n"
        "    public C(int a) {\n"
        "        var b = a;\n"
        "    }\n"
        "\n"
        "    public int Plain(int a)\n"
        "    {\n"
        "        return a;\n"
        "    }\n"
        "\n"
        "    public int One() => 1;\n"
        "}\n",
    )
    spans = {
        m["name"]: (m["line"], m["end_line"]) for m in member(document, "App/A.cs", "C")["methods"]
    }

    assert spans == {"C": (3, 5), "Plain": (7, 10), "One": (12, 12)}
