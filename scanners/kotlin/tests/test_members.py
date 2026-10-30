import pytest
from conftest import member, module


def one(run, body: str) -> dict:
    return run({"a/F.kt": f"package p\n\n{body}\n"})


@pytest.mark.parametrize(
    ("body", "name", "kind"),
    [
        ("class A", "A", "class"),
        ("data class A(val x: Int)", "A", "class"),
        ("sealed class A", "A", "class"),
        ("enum class A {\n    X,\n    Y\n}", "A", "class"),
        ("annotation class A", "A", "class"),
        ("@JvmInline\nvalue class A(val x: Int)", "A", "class"),
        ("object A", "A", "class"),
        ("interface A", "A", "interface"),
        ("fun interface A {\n    fun run()\n}", "A", "interface"),
        ("typealias A = String", "A", "type"),
        ("const val A = 1", "A", "constant"),
        ("val A: Int = 1", "A", "constant"),
        ("fun a() = 1", "a", "function"),
    ],
)
def test_each_declaration_form_maps_to_its_kind(run, body, name, kind):
    assert member(one(run, body), "a", name)["kind"] == kind


@pytest.mark.parametrize("visibility", ["public", "protected", "internal", "private"])
def test_visibility_is_the_declared_modifier_and_exported_agrees(run, visibility):
    document = one(run, f"{visibility} class A")
    found = member(document, "a", "A")

    assert found["visibility"] == visibility
    assert found["exported"] is (visibility != "private")


def test_visibility_defaults_to_public(run):
    found = member(one(run, "fun a() = 1"), "a", "a")

    assert (found["visibility"], found["exported"]) == ("public", True)


def test_an_extension_function_is_named_without_its_receiver(run):
    document = one(run, "class Order\n\nfun Order.total(): Int = 1")

    assert member(document, "a", "total")["kind"] == "function"
    assert "Order.total" not in [m["name"] for m in module(document, "a")["members"]]


def test_a_companion_object_is_a_member_with_its_functions_as_static_methods(run):
    document = one(run, "class A {\n    companion object {\n        fun make() = 1\n    }\n}")
    companion = member(document, "a", "A.Companion")

    assert companion["kind"] == "class"
    assert companion["methods"][0]["name"] == "make"
    assert companion["methods"][0]["tags"] == ["static"]
    assert member(document, "a", "A")["methods"] == []


def test_a_named_companion_object_is_named_after_its_outer_class(run):
    document = one(
        run, "class A {\n    companion object Factory {\n        const val K = 1\n    }\n}"
    )

    assert "A.Factory" in [m["name"] for m in module(document, "a")["members"]]


def test_nested_classes_are_not_members(run):
    document = one(run, "class A {\n    class Inner\n}")

    assert [m["name"] for m in module(document, "a")["members"]] == ["A"]


def test_a_class_outline_has_bases_fields_and_methods(run):
    document = one(
        run,
        "class A(private val x: Int, val y: String?) : Base(), Port {\n"
        "    var z: Long = 1\n"
        "    private fun hidden(a: Int, b: String): Boolean = true\n"
        "    fun open() {}\n"
        "}",
    )
    found = member(document, "a", "A")

    assert found["bases"] == ["Base", "Port"]
    assert [(f["name"], f.get("type"), f["private"]) for f in found["fields"]] == [
        ("x", "Int", True),
        ("y", "String?", False),
        ("z", "Long", False),
    ]
    assert found["methods"][0] == {
        "name": "hidden",
        "line": 5,
        "params": [{"name": "a", "type": "Int"}, {"name": "b", "type": "String"}],
        "private": True,
        "returns": "Boolean",
    }
    assert "returns" not in found["methods"][1]


def test_abstract_and_interface_methods_are_tagged_abstract(run):
    document = one(
        run,
        "interface P {\n    fun a(): Int\n    fun b() = 1\n}\n\n"
        "abstract class C {\n    abstract fun c()\n}",
    )

    assert [m.get("tags") for m in member(document, "a", "P")["methods"]] == [["abstract"], None]
    assert member(document, "a", "C")["methods"][0]["tags"] == ["abstract"]


def test_a_function_member_has_params_and_a_declared_return_type(run):
    found = member(one(run, 'fun a(x: Int): String = ""'), "a", "a")

    assert found["params"] == [{"name": "x", "type": "Int"}]
    assert found["returns"] == "String"


def test_a_constant_keeps_a_short_value(run):
    assert member(one(run, 'const val A = "x"'), "a", "A")["value"] == '"x"'


def test_a_module_of_only_interfaces_is_an_interface_module(run):
    document = run(
        {
            "a/P.kt": "package p\n\ninterface P\n",
            "b/Q.kt": "package p\n\ninterface Q\n\nclass Hidden\n".replace(
                "class Hidden", "private class Hidden"
            ),
            "c/R.kt": "package p\n\ninterface R\n\nclass C\n",
        }
    )

    assert [m["kind"] for m in document["modules"]] == ["interface", "interface", "package"]


def test_the_module_id_is_the_directory_and_the_root_is_a_dot(run):
    document = run({"A.kt": "class A\n", "x/y/B.kt": "package x.y\n\nclass B\n"})

    assert [m["id"] for m in document["modules"]] == [".", "x/y"]


def test_files_list_every_read_file_with_its_hash_sorted_by_path(run):
    import hashlib

    document = run({"b/B.kt": "class B\n", "a/A.kt": "class A\n"})

    assert document["files"] == [
        {"path": "a/A.kt", "hash": hashlib.sha256(b"class A\n").hexdigest()},
        {"path": "b/B.kt", "hash": hashlib.sha256(b"class B\n").hexdigest()},
    ]
