from conftest import calls_of, csproj

APP = {"App/App.csproj": csproj()}
STORE = "namespace Dom;\npublic interface IStore { void Save(int x); }\n"
USE = "App/Use.cs"


def app(files: dict[str, str]) -> dict[str, str]:
    return APP | files


def use(body: str, head: str = "using Dom;\nnamespace Svc;\n") -> dict[str, str]:
    return app({"App/Store.cs": STORE, USE: head + body})


def calls(document: dict, how: str = "call") -> list[tuple]:
    return calls_of(document, how=how)


def one(document: dict, line: int, target: str = "App/Store.cs::IStore.Save") -> None:
    assert calls(document) == [(f"{USE}::Use.Go", target, line, "call")]


def test_a_method_parameter_receiver_gives_a_call(run):
    document = run(use("public class Use {\n public void Go(IStore s) {\n s.Save(1);\n }\n}\n"))

    one(document, 5)


def test_a_constructor_parameter_is_in_scope_only_inside_that_constructor(run):
    document = run(
        use(
            "public class Use {\n public Use(IStore s) { s.Save(1); }\n public void Go() { s.Save(2); }\n}\n"
        )
    )

    assert calls(document) == [(f"{USE}::Use.Use", "App/Store.cs::IStore.Save", 4, "call")]


def test_a_primary_constructor_parameter_gives_a_call(run):
    document = run(use("public class Use(IStore s) {\n public void Go() { s.Save(1); }\n}\n"))

    one(document, 4)


def test_a_field_gives_a_call(run):
    document = run(use("public class Use {\n IStore s;\n public void Go() { s.Save(1); }\n}\n"))

    one(document, 5)


def test_a_property_gives_a_call(run):
    document = run(
        use("public class Use {\n IStore S { get; }\n public void Go() { S.Save(1); }\n}\n")
    )

    one(document, 5)


def test_a_records_positional_parameter_gives_a_call(run):
    document = run(use("public record Use(IStore S) {\n public void Go() { S.Save(1); }\n}\n"))

    one(document, 4)


def test_this_field_gives_a_call(run):
    document = run(
        use("public class Use {\n IStore s;\n public void Go() { this.s.Save(1); }\n}\n")
    )

    one(document, 5)


def test_a_nullable_declared_type_resolves_to_the_head_type(run):
    document = run(use("public class Use {\n public void Go(IStore? s) { s?.Save(1); }\n}\n"))

    one(document, 4)


def test_a_generic_declared_type_resolves_to_the_head_type(run):
    document = run(
        app(
            {
                "App/Repo.cs": "namespace Dom;\npublic interface IRepo<T> { void Add(T x); }\n",
                USE: "using Dom;\nnamespace Svc;\npublic class Use {\n public void Go(IRepo<int> r) { r.Add(1); }\n}\n",
            }
        )
    )

    one(document, 4, "App/Repo.cs::IRepo.Add")


def test_a_parameter_wins_over_a_field_of_the_same_name(run):
    document = run(
        app(
            {
                "App/Store.cs": STORE + "public interface IOther { void Save(int x); }\n",
                USE: "using Dom;\nnamespace Svc;\npublic class Use {\n IOther s;\n public void Go(IStore s) { s.Save(1); }\n}\n",
            }
        )
    )

    one(document, 5)


def test_a_method_on_a_base_type_is_the_target(run):
    document = run(
        app(
            {
                "App/Base.cs": "namespace Dom;\npublic class Base { public void Save(int x) {} }\npublic class Child : Base {}\n",
                USE: "using Dom;\nnamespace Svc;\npublic class Use {\n public void Go(Child c) { c.Save(1); }\n}\n",
            }
        )
    )

    one(document, 4, "App/Base.cs::Base.Save")


def test_a_method_on_a_second_partial_part_is_the_target(run):
    document = run(
        app(
            {
                "App/A.cs": "namespace Dom;\npublic partial class Part { }\n",
                "App/B.cs": "namespace Dom;\npublic partial class Part { public void Save(int x) {} }\n",
                USE: "using Dom;\nnamespace Svc;\npublic class Use {\n public void Go(Part p) { p.Save(1); }\n}\n",
            }
        )
    )

    one(document, 4, "App/B.cs::Part.Save")


def test_an_aliased_type_resolves(run):
    document = run(
        use(
            "public class Use {\n public void Go(Alias s) { s.Save(1); }\n}\n",
            "using Alias = Dom.IStore;\nnamespace Svc;\n",
        )
    )

    one(document, 4)


def test_a_type_from_a_global_using_resolves(run):
    document = run(
        app(
            {
                "App/Store.cs": STORE,
                "App/Globals.cs": "global using Dom;\n",
                USE: "namespace Svc;\npublic class Use {\n public void Go(IStore s) { s.Save(1); }\n}\n",
            }
        )
    )

    one(document, 3)


def test_an_internal_type_across_a_project_without_a_reference_gives_no_call(run):
    document = run(
        {
            "Lib/Lib.csproj": csproj(),
            "Lib/Store.cs": "namespace Dom;\ninternal interface IStore { void Save(int x); }\n",
            "App/App.csproj": csproj(),
            USE: "using Dom;\nnamespace Svc;\npublic class Use {\n public void Go(IStore s) { s.Save(1); }\n}\n",
        }
    )

    assert calls(document) == []


def test_a_plain_static_call_gives_a_call(run):
    document = run(
        app(
            {
                "App/Util.cs": "namespace Dom;\npublic static class Util { public static void Run() {} }\n",
                USE: "using Dom;\nnamespace Svc;\npublic class Use {\n public void Go() { Util.Run(); }\n}\n",
            }
        )
    )

    one(document, 4, "App/Util.cs::Util.Run")


def test_a_namespace_qualified_static_call_gives_a_call(run):
    document = run(
        app(
            {
                "App/Util.cs": "namespace Dom;\npublic static class Util { public static void Run() {} }\n",
                USE: "namespace Svc;\npublic class Use {\n public void Go() { Dom.Util.Run(); }\n}\n",
            }
        )
    )

    one(document, 3, "App/Util.cs::Util.Run")


def test_a_non_static_method_named_through_a_type_gives_no_call(run):
    document = run(
        app(
            {
                "App/Util.cs": "namespace Dom;\npublic class Util { public void Run() {} }\n",
                USE: "using Dom;\nnamespace Svc;\npublic class Use {\n public void Go() { Util.Run(); }\n}\n",
            }
        )
    )

    assert calls(document) == []


EXT = "namespace Ext;\npublic static class Texts { public static string Shout(this string s) => s; }\n"


def test_an_extension_call_on_a_chain_receiver_gives_a_call(run):
    document = run(
        app(
            {
                "App/Texts.cs": EXT,
                USE: "using Ext;\nnamespace Svc;\npublic class Use {\n public string Go(int n) => n.ToString().Shout();\n}\n",
            }
        )
    )

    one(document, 4, "App/Texts.cs::Texts.Shout")


def test_an_extension_call_on_a_framework_typed_receiver_gives_a_call(run):
    document = run(
        app(
            {
                "App/Texts.cs": EXT,
                USE: "using Ext;\nnamespace Svc;\npublic class Use {\n public string Go(string t) => t.Shout();\n}\n",
            }
        )
    )

    one(document, 4, "App/Texts.cs::Texts.Shout")


def test_the_same_extension_in_two_reachable_types_gives_two_calls(run):
    document = run(
        app(
            {
                "App/Texts.cs": EXT,
                "App/More.cs": EXT.replace("Texts", "More"),
                USE: "using Ext;\nnamespace Svc;\npublic class Use {\n public string Go(string t) => t.Shout();\n}\n",
            }
        )
    )

    assert [c[1] for c in calls(document)] == [
        "App/More.cs::More.Shout",
        "App/Texts.cs::Texts.Shout",
    ]


def test_an_extension_in_an_unreachable_project_gives_no_call(run):
    document = run(
        {
            "Lib/Lib.csproj": csproj(),
            "Lib/Texts.cs": EXT,
            "App/App.csproj": csproj(),
            USE: "using Ext;\nnamespace Svc;\npublic class Use {\n public string Go(string t) => t.Shout();\n}\n",
        }
    )

    assert calls(document) == []


def test_a_declared_in_repo_receiver_with_the_method_is_an_instance_call_only(run):
    document = run(
        app(
            {
                "App/Texts.cs": EXT,
                "App/Own.cs": 'namespace Dom;\npublic class Own { public string Shout() => ""; }\n',
                USE: "using Ext;\nusing Dom;\nnamespace Svc;\npublic class Use {\n public string Go(Own o) => o.Shout();\n}\n",
            }
        )
    )

    one(document, 5, "App/Own.cs::Own.Shout")


def test_a_call_to_an_extension_block_member_targets_it(run):
    document = run(
        app(
            {
                "App/Block.cs": "namespace Ext;\npublic static class Block { extension(string s) { public int Size() => 1; } }\n",
                USE: "using Ext;\nnamespace Svc;\npublic class Use {\n public int Go(string t) => t.Size();\n}\n",
            }
        )
    )

    one(document, 4, "App/Block.cs::Block.Size")


def dispatches(document: dict) -> list[tuple]:
    return [(c[0], c[1], c[2]) for c in calls(document, "dispatch")]


def test_an_interface_method_dispatches_to_its_implementer(run):
    document = run(
        app(
            {
                "App/Store.cs": STORE,
                "App/Sql.cs": "using Dom;\nnamespace Inf;\npublic class Sql : IStore { public void Save(int x) {} }\n",
            }
        )
    )

    assert dispatches(document) == [("App/Store.cs::IStore.Save", "App/Sql.cs::Sql.Save", 2)]


def test_an_interface_method_dispatches_to_each_implementer(run):
    document = run(
        app(
            {
                "App/Store.cs": STORE,
                "App/A.cs": "using Dom;\nnamespace Inf;\npublic class A : IStore { public void Save(int x) {} }\n",
                "App/B.cs": "using Dom;\nnamespace Inf;\npublic class B : IStore { public void Save(int x) {} }\n",
            }
        )
    )

    assert [d[1] for d in dispatches(document)] == ["App/A.cs::A.Save", "App/B.cs::B.Save"]


def test_dispatch_reaches_a_type_derived_from_an_implementer(run):
    document = run(
        app(
            {
                "App/Store.cs": STORE,
                "App/A.cs": "using Dom;\nnamespace Inf;\npublic class A : IStore { public virtual void Save(int x) {} }\n",
                "App/B.cs": "namespace Inf;\npublic class B : A { public override void Save(int x) {} }\n",
            }
        )
    )

    assert [d[1] for d in dispatches(document)] == ["App/A.cs::A.Save", "App/B.cs::B.Save"]


def test_an_abstract_class_method_dispatches_to_the_override(run):
    document = run(
        app(
            {
                "App/Base.cs": "namespace Dom;\npublic abstract class Base { public abstract void Run(); }\n",
                "App/Impl.cs": "using Dom;\nnamespace Inf;\npublic class Impl : Base { public override void Run() {} }\n",
            }
        )
    )

    assert dispatches(document) == [("App/Base.cs::Base.Run", "App/Impl.cs::Impl.Run", 2)]


def test_a_subclass_that_redeclares_the_method_abstract_gets_no_dispatch(run):
    document = run(
        app(
            {
                "App/Base.cs": "namespace Dom;\npublic abstract class Base { public abstract void Run(); }\n",
                "App/Mid.cs": "using Dom;\nnamespace Inf;\npublic abstract class Mid : Base { public abstract override void Run(); }\n",
            }
        )
    )

    assert dispatches(document) == []


def test_a_default_interface_method_is_not_a_dispatch_source(run):
    document = run(
        app(
            {
                "App/Store.cs": "namespace Dom;\npublic interface IStore { void Save(int x) {} }\n",
                "App/Sql.cs": "using Dom;\nnamespace Inf;\npublic class Sql : IStore { public void Save(int x) {} }\n",
            }
        )
    )

    assert dispatches(document) == []


def test_only_the_resolving_call_is_written_among_three(run):
    document = run(
        use(
            "public class Use {\n public void Go(IStore s, System.IO.Stream f) {\n s.Save(1);\n f.Flush();\n var v = Make();\n v.Save(2);\n }\n}\n"
        )
    )

    one(document, 5)


def test_overloads_give_one_call_per_source_line_and_target(run):
    document = run(
        app(
            {
                "App/Store.cs": "namespace Dom;\npublic interface IStore { void Save(int x); void Save(string x); }\n",
                USE: "using Dom;\nnamespace Svc;\npublic class Use {\n public void Go(IStore s) { s.Save(1); }\n}\n",
            }
        )
    )

    one(document, 4)


def test_calls_outside_an_outline_method_are_not_written(run):
    document = run(
        use(
            "public class Use {\n IStore s;\n public int P { get { s.Save(1); return 1; } }\n int f = Init();\n static int Init() { return 1; }\n"
            " class Inner { IStore t; void M() { t.Save(2); } }\n}\n"
        )
    )

    assert calls(document) == []


def test_a_var_local_a_chain_and_new_make_no_instance_call(run):
    document = run(
        use(
            "public class Use {\n IStore s;\n public void Go() {\n var v = s;\n v.Save(1);\n this.s.Self().Save(2);\n new Use();\n }\n}\n"
        )
    )

    assert calls(document) == []


def test_a_lambda_and_a_local_function_belong_to_the_enclosing_method(run):
    document = run(
        use(
            "public class Use {\n public void Go(IStore s) {\n System.Action a = () => s.Save(1);\n void Local() { s.Save(2); }\n }\n}\n"
        )
    )

    assert calls(document) == [
        (f"{USE}::Use.Go", "App/Store.cs::IStore.Save", 5, "call"),
        (f"{USE}::Use.Go", "App/Store.cs::IStore.Save", 6, "call"),
    ]
