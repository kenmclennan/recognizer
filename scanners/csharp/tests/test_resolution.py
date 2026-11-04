from pathlib import Path

import pytest
from conftest import csproj, edges_of, local_targets, targets

APP = {"App/App.csproj": csproj()}


def app(files: dict[str, str]) -> dict[str, str]:
    return APP | files


def test_a_using_gives_an_edge_per_used_name_only(run):
    document = run(
        app(
            {
                "App/Domain.cs": "namespace Dom;\npublic class Used {}\npublic class Unused {}\n",
                "App/Use.cs": "using Dom;\nnamespace Svc;\npublic class Use { Used u; }\n",
            }
        )
    )

    assert targets(document, "App/Use.cs") == {"App/Domain.cs": ["Used"]}


def test_an_unused_using_gives_no_edge(run):
    document = run(
        app(
            {
                "App/Domain.cs": "namespace Dom;\npublic class Used {}\n",
                "App/Use.cs": "using Dom;\nnamespace Svc;\npublic class Use {}\n",
            }
        )
    )

    assert local_targets(document, "App/Use.cs") == {}


def test_the_files_own_namespace_and_its_parents_need_no_using(run):
    document = run(
        app(
            {
                "App/Parent.cs": "namespace Shop;\npublic class Parent {}\n",
                "App/Same.cs": "namespace Shop.Web;\npublic class Same {}\n",
                "App/Use.cs": "namespace Shop.Web;\npublic class Use { Parent p; Same s; }\n",
            }
        )
    )

    assert set(targets(document, "App/Use.cs")) == {"App/Parent.cs", "App/Same.cs"}


def test_using_static_makes_an_edge_for_a_used_member_name(run):
    document = run(
        app(
            {
                "App/Math.cs": "namespace Lib;\npublic static class Maths { public static int Twice(int x) => x; public static int Other() => 1; }\n",
                "App/Use.cs": "using static Lib.Maths;\nnamespace Svc;\npublic class Use { int V() => Twice(1); }\n",
            }
        )
    )

    assert targets(document, "App/Use.cs") == {"App/Math.cs": ["Twice"]}


def test_using_static_without_a_used_member_makes_no_edge(run):
    document = run(
        app(
            {
                "App/Math.cs": "namespace Lib;\npublic static class Maths { public static int Twice(int x) => x; }\n",
                "App/Use.cs": "using static Lib.Maths;\nnamespace Svc;\npublic class Use {}\n",
            }
        )
    )

    assert local_targets(document, "App/Use.cs") == {}


def test_an_alias_using_resolves_the_alias_to_the_real_type(run):
    document = run(
        app(
            {
                "App/Domain.cs": "namespace Dom.Deep;\npublic class Order {}\n",
                "App/Use.cs": "using O = Dom.Deep.Order;\nnamespace Svc;\npublic class Use { O field; }\n",
            }
        )
    )

    assert targets(document, "App/Use.cs") == {"App/Domain.cs": ["Order"]}


def test_a_global_using_in_another_file_of_the_project_applies(run):
    document = run(
        app(
            {
                "App/Domain.cs": "namespace Dom;\npublic class Order {}\n",
                "App/Globals.cs": "global using Dom;\n",
                "App/Use.cs": "namespace Svc;\npublic class Use { Order o; }\n",
            }
        )
    )

    assert targets(document, "App/Use.cs") == {"App/Domain.cs": ["Order"]}


def test_a_global_using_in_another_project_does_not_apply(run):
    document = run(
        {
            "Dom/Dom.csproj": csproj(),
            "Dom/Domain.cs": "namespace Dom;\npublic class Order {}\n",
            "One/One.csproj": csproj(references=("..\\Dom\\Dom.csproj",)),
            "One/Globals.cs": "global using Dom;\n",
            "Two/Two.csproj": csproj(references=("..\\Dom\\Dom.csproj",)),
            "Two/Use.cs": "namespace Svc;\npublic class Use { Order o; }\n",
        }
    )

    assert local_targets(document, "Two/Use.cs") == {}


def test_implicit_usings_supply_namespaces_for_the_web_sdk(run):
    document = run(
        {
            "Dom/Dom.csproj": csproj(),
            "Dom/Hosting.cs": "namespace Microsoft.Extensions.Hosting;\npublic class HostThing {}\n",
            "Web/Web.csproj": csproj(
                sdk="Microsoft.NET.Sdk.Web",
                properties={"ImplicitUsings": "enable"},
                references=("..\\Dom\\Dom.csproj",),
            ),
            "Web/Use.cs": "namespace Svc;\npublic class Use { HostThing h; }\n",
        }
    )

    assert targets(document, "Web/Use.cs") == {"Dom/Hosting.cs": ["HostThing"]}


def test_implicit_usings_supply_namespaces_for_the_worker_sdk(run):
    document = run(
        {
            "Dom/Dom.csproj": csproj(),
            "Dom/Hosting.cs": "namespace Microsoft.Extensions.Hosting;\npublic class HostThing {}\n",
            "Wk/Wk.csproj": csproj(
                sdk="Microsoft.NET.Sdk.Worker",
                properties={"ImplicitUsings": "enable"},
                references=("..\\Dom\\Dom.csproj",),
            ),
            "Wk/Use.cs": "namespace Svc;\npublic class Use { HostThing h; }\n",
        }
    )

    assert targets(document, "Wk/Use.cs") == {"Dom/Hosting.cs": ["HostThing"]}


def test_implicit_usings_of_the_plain_sdk_do_not_include_hosting(run):
    document = run(
        {
            "Dom/Dom.csproj": csproj(),
            "Dom/Hosting.cs": "namespace Microsoft.Extensions.Hosting;\npublic class HostThing {}\n",
            "App/App.csproj": csproj(
                properties={"ImplicitUsings": "enable"}, references=("..\\Dom\\Dom.csproj",)
            ),
            "App/Use.cs": "namespace Svc;\npublic class Use { HostThing h; }\n",
        }
    )

    assert local_targets(document, "App/Use.cs") == {}


def test_implicit_usings_are_off_unless_enabled(run):
    document = run(
        {
            "Dom/Dom.csproj": csproj(),
            "Dom/Hosting.cs": "namespace Microsoft.Extensions.Hosting;\npublic class HostThing {}\n",
            "Web/Web.csproj": csproj(
                sdk="Microsoft.NET.Sdk.Web", references=("..\\Dom\\Dom.csproj",)
            ),
            "Web/Use.cs": "namespace Svc;\npublic class Use { HostThing h; }\n",
        }
    )

    assert local_targets(document, "Web/Use.cs") == {}


def test_a_using_item_in_the_csproj_applies_to_the_project(run):
    document = run(
        {
            "App/App.csproj": csproj(usings=("Dom",)),
            "App/Domain.cs": "namespace Dom;\npublic class Order {}\n",
            "App/Use.cs": "namespace Svc;\npublic class Use { Order o; }\n",
        }
    )

    assert targets(document, "App/Use.cs") == {"App/Domain.cs": ["Order"]}


def test_a_fully_qualified_use_in_code_is_an_edge(run):
    document = run(
        app(
            {
                "App/Domain.cs": "namespace Dom.Deep;\npublic class Order { public static int Make() => 1; }\n",
                "App/Use.cs": "namespace Svc;\npublic class Use { int V() => Dom.Deep.Order.Make(); }\n",
            }
        )
    )

    assert targets(document, "App/Use.cs") == {"App/Domain.cs": ["Order"]}


def test_a_global_prefixed_name_resolves(run):
    document = run(
        app(
            {
                "App/Domain.cs": "namespace Dom;\npublic class Order {}\n",
                "App/Use.cs": "namespace Svc;\npublic class Use { global::Dom.Order o; }\n",
            }
        )
    )

    assert targets(document, "App/Use.cs") == {"App/Domain.cs": ["Order"]}


def test_a_name_declared_in_the_same_file_makes_no_edge(run):
    document = run(
        app({"App/Both.cs": "namespace N;\npublic class A { B b; }\npublic class B {}\n"})
    )

    assert document["edges"] == []


def test_every_use_position_makes_an_edge(run):
    types = {
        f"App/{n}.cs": f"namespace D;\npublic class {n} : System.Attribute {{}}\n"
        for n in ("Ctor", "Fld", "Prop", "Base", "Param", "Ret", "New", "Stat", "Gen", "Typ")
    }
    types["App/Attr.cs"] = "namespace D;\npublic class MarkAttribute : System.Attribute {}\n"
    types["App/Iface.cs"] = "namespace D;\npublic interface IBase {}\n"
    use = (
        "using D;\nnamespace Svc;\n"
        "[Mark] public class Use : IBase {\n"
        "  Fld f; public Prop P { get; }\n"
        "  public Use(Ctor c) {}\n"
        "  public Ret M(Param p) { var n = new New(); Stat.X(); var l = new List<Gen>(); var t = typeof(Typ); return null; }\n"
        "}\n"
    )
    document = run(app(types | {"App/Use.cs": use}))
    got = {Path(t).stem for t in targets(document, "App/Use.cs") if not t.startswith("foreign:")}

    assert got == {
        "Attr",
        "Iface",
        "Fld",
        "Prop",
        "Ctor",
        "Ret",
        "Param",
        "New",
        "Stat",
        "Gen",
        "Typ",
    }


def test_primary_constructor_parameters_are_uses(run):
    document = run(
        app(
            {
                "App/Dep.cs": "namespace D;\npublic class Dep {}\n",
                "App/Use.cs": "using D;\nnamespace S;\npublic class Use(Dep dep) {}\n",
            }
        )
    )

    assert targets(document, "App/Use.cs") == {"App/Dep.cs": ["Dep"]}


def test_inherits_and_implements_edges_carry_member_and_to_member(run):
    document = run(
        app(
            {
                "App/Base.cs": "namespace D;\npublic class Base {}\npublic interface IThing {}\n",
                "App/Use.cs": "using D;\nnamespace S;\npublic class Use : Base, IThing {}\n",
            }
        )
    )
    kinds = {e["kind"]: e for e in edges_of(document, "App/Use.cs") if e["kind"] != "depends"}

    assert kinds["inherits"]["to_member"] == "Base"
    assert kinds["implements"]["to_member"] == "IThing"
    assert kinds["implements"]["member"] == "Use"


def test_the_all_resolved_case_has_no_foreign_and_no_unresolved(run):
    document = run(
        app(
            {
                "App/Domain.cs": "namespace Dom;\npublic class Order {}\n",
                "App/Use.cs": "using Dom;\nnamespace Svc;\npublic class Use { Order o; }\n",
            }
        )
    )

    assert document["foreign"] == []
    assert document["unresolved_imports"] == []


def test_the_none_resolved_case_is_all_foreign(run):
    document = run(
        app(
            {
                "App/Use.cs": "using Newtonsoft.Json;\nnamespace Svc;\npublic class Use { JsonConvert c; }\n"
            }
        )
    )

    assert [f["name"] for f in document["foreign"]] == ["Newtonsoft.Json"]
    assert edges_of(document, "App/Use.cs")[0]["to"] == "foreign:Newtonsoft.Json"
    assert document["unresolved_imports"] == []


def test_mixed_resolution_reports_the_resolved_foreign_and_unresolved_outcomes_together(run):
    document = run(
        {
            "Shop/Shop.csproj": csproj(properties={"RootNamespace": "Shop"}),
            "Shop/Order.cs": "namespace Shop.Domain;\npublic class Order {}\n",
            "Shop/Use.cs": (
                "using Shop.Domain;\nusing Newtonsoft.Json;\nusing Shop.Generated;\n"
                "namespace Shop.Web;\n"
                "public class Use { Order o; JsonConvert c; }\n"
            ),
        }
    )

    assert targets(document, "Shop/Use.cs") == {
        "Shop/Order.cs": ["Order"],
        "foreign:Newtonsoft.Json": [],
    }
    assert [f["name"] for f in document["foreign"]] == ["Newtonsoft.Json"]
    assert document["unresolved_imports"] == [
        {"from": "Shop/Use.cs", "import": "Shop.Generated", "line": 3}
    ]


def test_a_using_of_a_declared_parent_namespace_is_not_unresolved(run):
    document = run(
        {
            "Shop/Shop.csproj": csproj(properties={"RootNamespace": "Shop"}),
            "Shop/Order.cs": "namespace Shop.Domain;\npublic class Order {}\n",
            "Shop/Use.cs": "using Shop;\nnamespace Shop.Web;\npublic class Use {}\n",
        }
    )

    assert document["unresolved_imports"] == []


def test_partial_types_give_an_edge_to_every_declaring_file(run):
    document = run(
        app(
            {
                "App/One.cs": "namespace D;\npublic partial class Split {}\n",
                "App/Two.cs": "namespace D;\npublic partial class Split {}\n",
                "App/Use.cs": "using D;\nnamespace S;\npublic class Use { Split s; }\n",
            }
        )
    )

    assert set(targets(document, "App/Use.cs")) == {"App/One.cs", "App/Two.cs"}


def test_a_type_nested_in_another_partial_file_resolves(run):
    document = run(
        app(
            {
                "App/One.cs": "namespace D;\npublic partial class Outer { }\n",
                "App/Two.cs": "namespace D;\npublic partial class Outer { public class Inner {} }\n",
                "App/Use.cs": "namespace D;\npublic partial class Outer { Inner i; }\n",
            }
        )
    )

    assert "App/Two.cs" in targets(document, "App/Use.cs")


def test_a_type_nested_in_a_base_type_resolves(run):
    document = run(
        app(
            {
                "App/Base.cs": "namespace D;\npublic class Base { public class Inner {} }\n",
                "App/Use.cs": "namespace D;\npublic class Use : Base { Inner i; }\n",
            }
        )
    )

    assert "App/Base.cs" in targets(document, "App/Use.cs")


def two_projects(declaration: str, reference: bool = True, how: str = "project") -> dict[str, str]:
    package = ("Lib",) if how == "package" else ()
    refs = ("..\\Lib\\Lib.csproj",) if reference and how == "project" else ()

    return {
        "Lib/Lib.csproj": csproj(),
        "Lib/Thing.cs": f"namespace Lib;\n{declaration}\n",
        "App/App.csproj": csproj(references=refs, packages=package),
        "App/Use.cs": "using Lib;\nnamespace App;\npublic class Use { Thing t; }\n",
    }


def test_public_crosses_a_project_reference(run):
    document = run(two_projects("public class Thing {}"))

    assert targets(document, "App/Use.cs") == {"Lib/Thing.cs": ["Thing"]}


def test_protected_nested_style_visibility_crosses_a_project_reference(run):
    document = run(two_projects("public class Thing {}", how="package"))

    assert targets(document, "App/Use.cs") == {"Lib/Thing.cs": ["Thing"]}


def test_public_does_not_cross_without_a_reference(run):
    document = run(two_projects("public class Thing {}", reference=False))

    assert local_targets(document, "App/Use.cs") == {}


@pytest.mark.parametrize("declaration", ["internal class Thing {}", "class Thing {}"])
def test_internal_and_unmarked_do_not_cross_a_project_reference(run, declaration):
    document = run(two_projects(declaration))

    assert local_targets(document, "App/Use.cs") == {}


def test_a_file_type_resolves_only_in_its_own_file(run):
    document = run(
        app(
            {
                "App/Local.cs": "namespace D;\nfile class Hidden {}\npublic class Own { Hidden h; }\n",
                "App/Use.cs": "using D;\nnamespace S;\npublic class Use { Hidden h; }\n",
            }
        )
    )

    assert local_targets(document, "App/Use.cs") == {}


def test_the_same_name_declared_twice_resolves_to_the_visible_one(run):
    document = run(
        {
            "Lib/Lib.csproj": csproj(),
            "Lib/Secret.cs": "namespace Lib;\ninternal class Thing {}\n",
            "Other/Other.csproj": csproj(),
            "Other/Open.cs": "namespace Lib;\npublic class Thing {}\n",
            "App/App.csproj": csproj(references=("..\\Lib\\Lib.csproj", "..\\Other\\Other.csproj")),
            "App/Use.cs": "using Lib;\nnamespace App;\npublic class Use { Thing t; }\n",
        }
    )

    assert targets(document, "App/Use.cs") == {"Other/Open.cs": ["Thing"]}


def test_a_linked_compile_file_belongs_to_each_project_that_includes_it(run):
    document = run(
        {
            "Lib/Lib.csproj": csproj(),
            "Lib/Clock.cs": "namespace Lib;\ninternal class Clock {}\n",
            "Infra/Infra.csproj": csproj(compiles=(("..\\Lib\\Clock.cs", "Clock.cs"),)),
            "Infra/Use.cs": "using Lib;\nnamespace Infra;\npublic class Use { Clock c; }\n",
            "Web/Web.csproj": csproj(references=("..\\Lib\\Lib.csproj",)),
            "Web/Use.cs": "using Lib;\nnamespace Web;\npublic class Use { Clock c; }\n",
        }
    )

    assert targets(document, "Infra/Use.cs") == {"Lib/Clock.cs": ["Clock"]}
    assert local_targets(document, "Web/Use.cs") == {}


def test_a_wildcard_compile_include_makes_no_edge(run):
    document = run(
        {
            "Lib/Lib.csproj": csproj(),
            "Lib/Clock.cs": "namespace Lib;\ninternal class Clock {}\n",
            "Infra/Infra.csproj": csproj(compiles=(("..\\Lib\\*.cs", "x"),)),
            "Infra/Use.cs": "using Lib;\nnamespace Infra;\npublic class Use { Clock c; }\n",
        }
    )

    assert local_targets(document, "Infra/Use.cs") == {}


@pytest.mark.parametrize(
    ("text", "prefix"),
    [
        (csproj(properties={"RootNamespace": "Root.Ns", "AssemblyName": "Asm"}), "Root.Ns"),
        (csproj(properties={"AssemblyName": "Asm"}), "Asm"),
        (csproj(), "Named"),
    ],
    ids=["root-namespace", "assembly-name", "csproj-name"],
)
def test_a_project_prefix_is_root_namespace_then_assembly_name_then_the_csproj_name(
    run, text, prefix
):
    document = run(
        {
            "Named/Named.csproj": text,
            "Named/Use.cs": f"using {prefix}.Missing;\nnamespace X;\npublic class Use {{}}\n",
        }
    )

    assert [u["import"] for u in document["unresolved_imports"]] == [f"{prefix}.Missing"]


def test_a_borrowed_namespace_is_indexed_and_an_unresolved_name_under_it_is_foreign(run):
    document = run(
        {
            "Shop/Shop.csproj": csproj(properties={"RootNamespace": "Shop"}),
            "Shop/Ext.cs": "namespace Microsoft.Extensions.DependencyInjection;\npublic static class ShopExt {}\n",
            "Shop/Use.cs": (
                "using Microsoft.Extensions.DependencyInjection;\nnamespace Shop;\n"
                "public class Use { ShopExt e; IServiceCollection c; }\n"
            ),
        }
    )

    assert targets(document, "Shop/Use.cs") == {
        "Shop/Ext.cs": ["ShopExt"],
        "foreign:Microsoft.Extensions.DependencyInjection": [],
    }
    assert document["unresolved_imports"] == []
