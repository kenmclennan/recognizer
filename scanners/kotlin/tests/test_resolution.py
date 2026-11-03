from conftest import edges_of, targets

BUILD = {"app/build.gradle.kts": "", "lib/build.gradle.kts": ""}


def user(imports: str, body: str = "val x: X? = null", package: str = "q") -> str:
    return f"package {package}\n\n{imports}\n\nclass U {{\n    {body}\n}}\n"


def declares(package: str, body: str = "class X") -> str:
    return f"package {package}\n\n{body}\n"


def test_r1_explicit_import_makes_an_edge_with_the_used_name(run):
    document = run({"a/X.kt": declares("p"), "c/U.kt": user("import p.X")})

    assert targets(document, "c/U.kt") == {"a/X.kt": ["X"]}
    assert edges_of(document, "c/U.kt")[0]["line"] == 3


def test_r1_unused_import_makes_no_edge(run):
    document = run({"a/X.kt": declares("p"), "c/U.kt": user("import p.X", "val y = 1")})

    assert edges_of(document, "c/U.kt") == []


def test_r1_two_declaring_files_in_one_build_module_give_one_edge_each(run):
    document = run(
        {
            **BUILD,
            "app/a/X.kt": declares("p"),
            "app/b/X.kt": declares("p"),
            "app/c/U.kt": user("import p.X"),
        }
    )

    assert targets(document, "app/c/U.kt") == {"app/a/X.kt": ["X"], "app/b/X.kt": ["X"]}


def test_r1_a_declaration_in_another_build_module_is_dropped_for_the_importers_module(run):
    document = run(
        {
            **BUILD,
            "app/a/X.kt": declares("p"),
            "lib/d/X.kt": declares("p"),
            "app/c/U.kt": user("import p.X"),
        }
    )

    assert targets(document, "app/c/U.kt") == {"app/a/X.kt": ["X"]}


def test_r1_keeps_every_declaration_when_none_is_in_the_importers_build_module(run):
    document = run(
        {
            **BUILD,
            "lib/a/X.kt": declares("p"),
            "lib/b/X.kt": declares("p"),
            "app/c/U.kt": user("import p.X"),
        }
    )

    assert targets(document, "app/c/U.kt") == {"lib/a/X.kt": ["X"], "lib/b/X.kt": ["X"]}


def test_r1_resolves_a_top_level_function(run):
    document = run(
        {
            "a/F.kt": declares("p", "fun helper() = 1"),
            "c/U.kt": user("import p.helper", "val y = helper()"),
        }
    )

    assert targets(document, "c/U.kt") == {"a/F.kt": ["helper"]}


def test_r2_an_aliased_import_counts_as_a_use_and_names_the_real_name(run):
    document = run({"a/X.kt": declares("p"), "c/U.kt": user("import p.X as Y", "val x: Y? = null")})

    assert targets(document, "c/U.kt") == {"a/X.kt": ["X"]}


def test_r2_an_unused_alias_makes_no_edge_even_when_the_real_name_appears(run):
    document = run({"a/X.kt": declares("p"), "c/U.kt": user("import p.X as Y", "val x: X? = null")})

    assert edges_of(document, "c/U.kt") == []


def test_r3_a_nested_member_import_names_the_path_after_the_package(run):
    document = run(
        {
            "a/Outer.kt": declares("p", "class Outer {\n    class Inner\n}"),
            "c/U.kt": user("import p.Outer.Inner", "val x: Inner? = null"),
        }
    )

    assert targets(document, "c/U.kt") == {"a/Outer.kt": ["Outer.Inner"]}


def test_r3_an_unused_nested_member_import_makes_no_edge(run):
    document = run(
        {
            "a/Outer.kt": declares("p", "class Outer {\n    class Inner\n}"),
            "c/U.kt": user("import p.Outer.Inner", "val y = 1"),
        }
    )

    assert edges_of(document, "c/U.kt") == []


def test_r3_an_object_function_import_resolves_to_the_object(run):
    document = run(
        {
            "a/Util.kt": declares("p", "object Util {\n    fun go() = 1\n}"),
            "c/U.kt": user("import p.Util.go", "val y = go()"),
        }
    )

    assert targets(document, "c/U.kt") == {"a/Util.kt": ["Util.go"]}


def test_r4_a_wildcard_makes_an_edge_per_used_name_only(run):
    document = run(
        {
            "a/Names.kt": declares("p", "class X\n\nclass Z"),
            "c/U.kt": user("import p.*"),
        }
    )

    assert targets(document, "c/U.kt") == {"a/Names.kt": ["X"]}


def test_r4_a_wildcard_groups_used_names_by_declaring_file(run):
    document = run(
        {
            "a/X.kt": declares("p"),
            "b/Z.kt": declares("p", "class Z"),
            "c/U.kt": user("import p.*", "val x: X? = null\n    val z: Z? = null"),
        }
    )

    assert targets(document, "c/U.kt") == {"a/X.kt": ["X"], "b/Z.kt": ["Z"]}


def test_r4_a_wildcard_over_a_class_needs_a_used_member(run):
    files = {
        "a/B.kt": declares("p", "object B {\n    fun go() = 1\n}"),
        "c/U.kt": user("import p.B.*", "val y = go()"),
    }

    assert targets(run(files), "c/U.kt") == {"a/B.kt": ["B.go"]}
    assert edges_of(run({**files, "c/U.kt": user("import p.B.*", "val y = 1")}), "c/U.kt") == []


def test_r4_a_wildcard_over_an_undeclared_package_is_foreign_even_when_unused(run):
    document = run({"c/U.kt": user("import lib.other.*", "val y = 1")})

    assert targets(document, "c/U.kt") == {"foreign:lib.other": []}


def test_r5_the_same_package_in_another_file_makes_an_edge(run):
    document = run({"a/X.kt": declares("p"), "c/U.kt": user("", "val x: X? = null", package="p")})

    assert targets(document, "c/U.kt") == {"a/X.kt": ["X"]}


def test_r5_the_same_file_makes_no_edge(run):
    document = run({"a/X.kt": declares("p", "class X\n\nclass U {\n    val x: X? = null\n}")})

    assert document["edges"] == []


def test_r5_an_explicit_import_is_not_also_a_same_package_edge(run):
    document = run(
        {
            "a/X.kt": declares("p"),
            "b/X.kt": declares("r"),
            "c/U.kt": user("import r.X", "val x: X? = null", package="p"),
        }
    )

    assert targets(document, "c/U.kt") == {"b/X.kt": ["X"]}


def test_r5_prefers_the_importers_build_module(run):
    document = run(
        {
            **BUILD,
            "app/a/X.kt": declares("p"),
            "lib/b/X.kt": declares("p"),
            "app/c/U.kt": user("", "val x: X? = null", package="p"),
        }
    )

    assert targets(document, "app/c/U.kt") == {"app/a/X.kt": ["X"]}


def test_r6_a_fully_qualified_type_resolves_without_an_import(run):
    document = run({"a/X.kt": declares("p"), "c/U.kt": user("", "val x: p.X? = null")})

    assert targets(document, "c/U.kt") == {"a/X.kt": ["X"]}


def test_r6_a_fully_qualified_expression_resolves_without_an_import(run):
    document = run({"a/X.kt": declares("p"), "c/U.kt": user("", "val x = p.X()")})

    assert targets(document, "c/U.kt") == {"a/X.kt": ["X"]}


def test_r6_a_prefix_that_is_not_a_scanned_package_makes_no_edge(run):
    document = run({"a/X.kt": declares("p"), "c/U.kt": user("", "val x = z.X()")})

    assert edges_of(document, "c/U.kt") == []


MIXED = {
    "a/X.kt": declares("shop.core"),
    "gen/Y.kt": declares("shop.core.more", "class Y"),
    "c/U.kt": (
        "package shop.core.user\n\n"
        "import shop.core.X\n"
        "import shop.core.Missing\n"
        "import shop.core.gone.Gone\n"
        "import shop.core.more.*\n"
        "import kotlin.collections.List\n"
        "import org.other.Thing\n\n"
        "class U {\n"
        "    val a: X? = null\n"
        "    val c: Gone? = null\n"
        "    val d: List<Thing>? = null\n"
        "}\n"
    ),
}


def test_r7_unresolved_imports_list_only_the_ones_under_the_in_repo_prefix(run):
    document = run(MIXED)

    assert document["unresolved_imports"] == [
        {"from": "c/U.kt", "import": "shop.core.Missing", "line": 4},
        {"from": "c/U.kt", "import": "shop.core.gone.Gone", "line": 5},
    ]


def test_r7_foreign_edges_are_the_used_unresolved_and_the_library_imports(run):
    document = run(MIXED)
    foreign = {t for t in targets(document, "c/U.kt") if t.startswith("foreign:")}

    assert foreign == {"foreign:shop.core.gone", "foreign:kotlin.collections", "foreign:org.other"}


def test_r7_an_unused_unresolved_import_is_listed_without_a_foreign_edge(run):
    document = run(MIXED)

    assert "foreign:shop.core" not in targets(document, "c/U.kt")
    assert {"from": "c/U.kt", "import": "shop.core.Missing", "line": 4} in document[
        "unresolved_imports"
    ]


def test_r7_a_package_equal_to_the_prefix_is_under_it_and_one_above_is_not(run):
    document = run(
        {
            "a/X.kt": declares("shop.core"),
            "c/U.kt": user("import shop.core.Gone\nimport shop.Other", "val y = 1", "shop.core"),
        }
    )

    assert [u["import"] for u in document["unresolved_imports"]] == ["shop.core.Gone"]


def test_r7_a_wildcard_over_an_in_repo_undeclared_package_is_listed_with_its_star(run):
    document = run(
        {
            "a/X.kt": declares("shop.core"),
            "c/U.kt": user("import shop.core.gen.*", "val y = 1", "shop.core"),
        }
    )

    assert document["unresolved_imports"] == [
        {"from": "c/U.kt", "import": "shop.core.gen.*", "line": 3}
    ]
    assert targets(document, "c/U.kt") == {"foreign:shop.core.gen": []}


def test_r7_the_key_is_present_and_empty_when_nothing_qualifies(run):
    assert run({"a/X.kt": declares("p")})["unresolved_imports"] == []


def test_r8_a_class_implementing_an_interface_makes_an_implements_edge(run):
    document = run(
        {
            "a/Port.kt": declares("p", "interface Port"),
            "c/Impl.kt": "package q\n\nimport p.Port\n\nclass Impl : Port\n",
        }
    )
    edge = edges_of(document, "c/Impl.kt", "implements")[0]

    assert (edge["to"], edge["member"], edge["to_member"], edge["line"]) == (
        "a/Port.kt",
        "Impl",
        "Port",
        5,
    )
    assert targets(document, "c/Impl.kt") == {"a/Port.kt": ["Port"]}


def test_r8_a_class_extending_a_class_makes_an_inherits_edge(run):
    document = run(
        {
            "a/Base.kt": declares("p", "open class Base"),
            "c/Child.kt": "package q\n\nimport p.Base\n\nclass Child : Base()\n",
        }
    )
    edge = edges_of(document, "c/Child.kt", "inherits")[0]

    assert (edge["member"], edge["to_member"]) == ("Child", "Base")
    assert edges_of(document, "c/Child.kt", "implements") == []


def test_r8_an_interface_extending_an_interface_makes_an_inherits_edge(run):
    document = run(
        {
            "a/Port.kt": declares("p", "interface Port"),
            "c/Sub.kt": "package q\n\nimport p.Port\n\ninterface Sub : Port\n",
        }
    )

    assert [e["kind"] for e in edges_of(document, "c/Sub.kt") if "member" in e] == ["inherits"]


def test_r8_a_supertype_in_the_same_file_makes_no_edge(run):
    document = run({"a/All.kt": declares("p", "interface Port\n\nclass Impl : Port")})

    assert document["edges"] == []


def test_r8_a_supertype_declared_in_no_scanned_file_makes_no_inheritance_edge(run):
    document = run({"c/Impl.kt": "package q\n\nimport z.Port\n\nclass Impl : Port\n"})

    assert {e["kind"] for e in document["edges"]} == {"depends"}


def test_two_files_in_one_directory_make_one_edge_each(run):
    document = run(
        {
            "a/X.kt": declares("p", "class X\n\nclass Z"),
            "c/U1.kt": user("import p.X"),
            "c/U2.kt": user("import p.Z", "val z: Z? = null").replace("class U", "class V"),
        }
    )

    assert targets(document, "c/U1.kt") == {"a/X.kt": ["X"]}
    assert targets(document, "c/U2.kt") == {"a/X.kt": ["Z"]}


def test_same_package_a_name_declared_in_the_using_file_makes_no_edge_and_elsewhere_one_each(run):
    helper = declares("p", "fun helper() = 1")
    document = run(
        {
            "a/One.kt": helper,
            "a/Two.kt": helper,
            "a/Three.kt": declares("p", "fun helper() = 1\n\nfun go() = helper()"),
            "a/Four.kt": declares("p", "fun run() = helper()"),
        }
    )

    assert edges_of(document, "a/Three.kt") == []
    assert targets(document, "a/Four.kt") == {
        "a/One.kt": ["helper"],
        "a/Two.kt": ["helper"],
        "a/Three.kt": ["helper"],
    }


def test_a_file_with_no_declaration_is_a_module_with_no_members(run):
    document = run({"a/Empty.kt": "package p\n"})

    assert [m["id"] for m in document["modules"]] == ["a/Empty.kt"]
    assert document["modules"][0]["members"] == []
