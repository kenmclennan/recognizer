from conftest import call_tuples

STORE = (
    "from typing import Protocol\n"
    "class Store(Protocol):\n"
    "    def save(self, order): ...\n"
    "    def fetch(self, order_id): ...\n"
)


def test_direct_and_imported_names_and_construct(run):
    document = run(
        {
            "a.py": "class C: ...\ndef f(): ...\n",
            "b.py": (
                "from a import C, f\ndef local(): ...\ndef g():\n    f()\n    local()\n    C()\n"
            ),
        }
    )

    assert call_tuples(document) == [
        ("b.py::g", "a.py::f", "call"),
        ("b.py::g", "b.py::local", "call"),
        ("b.py::g", "a.py::C", "construct"),
    ]


def test_imported_names_follow_reexports(run):
    document = run(
        {
            "pkg/__init__.py": "from pkg.impl import f\n",
            "pkg/impl.py": "def f(): ...\n",
            "use.py": "from pkg import f\ndef g():\n    f()\n",
        }
    )

    assert call_tuples(document) == [("use.py::g", "pkg/impl.py::f", "call")]


def test_module_alias_attributes(run):
    document = run(
        {
            "pkg/__init__.py": "",
            "pkg/mod.py": "def f(): ...\n",
            "one.py": "import pkg.mod as x\ndef a():\n    x.f()\n",
            "two.py": "from pkg import mod\ndef b():\n    mod.f()\n",
            "three.py": "def c():\n    from pkg import mod\n    mod.f()\n",
            "four.py": "import pkg.mod\ndef d():\n    pkg.mod.f()\n",
        }
    )

    assert call_tuples(document) == [
        ("four.py::d", "pkg/mod.py::f", "call"),
        ("one.py::a", "pkg/mod.py::f", "call"),
        ("three.py::c", "pkg/mod.py::f", "call"),
        ("two.py::b", "pkg/mod.py::f", "call"),
    ]


def test_local_variable_assigned_from_a_constructor_or_annotated(run):
    document = run(
        {
            "a.py": "class C:\n    def m(self): ...\n",
            "b.py": (
                "from a import C\n"
                "def f():\n    c = C()\n    c.m()\n"
                "def g(x):\n    d: C = x\n    d.m()\n"
            ),
        }
    )

    assert call_tuples(document) == [
        ("b.py::f", "a.py::C", "construct"),
        ("b.py::f", "a.py::C.m", "call"),
        ("b.py::g", "a.py::C.m", "call"),
    ]


def test_self_attribute_typed_by_annotation_or_constructor(run):
    document = run(
        {
            "a.py": "class D:\n    def n(self): ...\nclass E:\n    def o(self): ...\n",
            "b.py": (
                "from a import D, E\n"
                "class C:\n"
                "    def __init__(self):\n"
                "        self.d: D = make()\n"
                "        self.e = E()\n"
                "    def m(self):\n"
                "        self.d.n()\n"
                "        self.e.o()\n"
            ),
        }
    )

    assert call_tuples(document) == [
        ("b.py::C.__init__", "a.py::E", "construct"),
        ("b.py::C.m", "a.py::D.n", "call"),
        ("b.py::C.m", "a.py::E.o", "call"),
    ]


def test_self_and_cls_calls_find_the_nearest_defining_class(run):
    document = run(
        {
            "a.py": "class Base:\n    def helper(self): ...\n    def over(self): ...\n",
            "b.py": (
                "from a import Base\n"
                "class C(Base):\n"
                "    def over(self): ...\n"
                "    def m(self):\n        self.helper()\n        self.over()\n"
                "    @classmethod\n"
                "    def k(cls):\n        cls.over()\n"
            ),
        }
    )

    assert call_tuples(document) == [
        ("b.py::C.k", "b.py::C.over", "call"),
        ("b.py::C.m", "a.py::Base.helper", "call"),
        ("b.py::C.m", "b.py::C.over", "call"),
    ]


def test_super_calls_are_not_resolved(run):
    document = run(
        {
            "a.py": "class Base:\n    def m(self): ...\n",
            "b.py": "from a import Base\nclass C(Base):\n    def m(self):\n        super().m()\n",
        }
    )

    assert document["calls"] == []


def test_chained_call_on_a_constructed_object(run):
    document = run(
        {
            "a.py": "class C:\n    def m(self): ...\n",
            "b.py": "from a import C\ndef f():\n    C().m()\n",
        }
    )

    assert call_tuples(document) == [
        ("b.py::f", "a.py::C", "construct"),
        ("b.py::f", "a.py::C.m", "call"),
    ]


def test_annotated_parameters_unwrap_optional_and_strings(run):
    document = run(
        {
            "a.py": "class C:\n    def m(self): ...\n",
            "b.py": (
                "from typing import Optional\nfrom a import C\n"
                "def f(x: C): x.m()\n"
                "def g(x: Optional[C]): x.m()\n"
                "def h(x: C | None): x.m()\n"
                "def i(x: 'C'): x.m()\n"
            ),
        }
    )

    assert [c[0] for c in call_tuples(document)] == ["b.py::f", "b.py::g", "b.py::h", "b.py::i"]
    assert {c[1] for c in call_tuples(document)} == {"a.py::C.m"}


def test_untyped_parameter_is_inferred_and_dispatched(run):
    document = run(
        {
            "store.py": STORE,
            "memory.py": (
                "from store import Store\nclass Memory(Store):\n    def save(self, order): ...\n"
            ),
            "use.py": "def f(store, order):\n    store.save(order)\n",
        }
    )

    assert call_tuples(document) == [
        ("store.py::Store.save", "memory.py::Memory.save", "dispatch"),
        ("use.py::f", "store.py::Store.save", "inferred"),
    ]


def test_untyped_parameter_stored_on_self_is_inferred_in_other_methods(run):
    document = run(
        {
            "store.py": STORE,
            "use.py": (
                "class U:\n"
                "    def __init__(self, store):\n        self.store = store\n"
                "    def go(self):\n        self.store.fetch(1)\n"
            ),
        }
    )

    assert call_tuples(document) == [("use.py::U.go", "store.py::Store.fetch", "inferred")]


def classes_with_save(count):
    files = {
        f"c{n}.py": f"class C{n}:\n    def save(self): ...\n    def fetch(self): ...\n"
        for n in range(count)
    }
    files["use.py"] = "def f(store):\n    store.save()\n    store.fetch()\n"

    return files


def test_inference_emits_with_exactly_four_matching_classes(run):
    document = run(classes_with_save(4))

    assert len([c for c in document["calls"] if c["how"] == "inferred"]) == 8


def test_inference_emits_nothing_with_five_matching_classes(run):
    document = run(classes_with_save(5))

    assert document["calls"] == []


def test_unresolvable_call_does_not_hide_the_resolvable_one(run):
    document = run(
        {
            "a.py": "def f(): ...\n",
            "b.py": (
                "import os\nfrom a import f\ndef g(x):\n    os.getcwd()\n"
                "    mystery()\n    f()\n    x.unknown()\n"
            ),
        }
    )

    assert call_tuples(document) == [("b.py::g", "a.py::f", "call")]


def test_private_helper_chain_records_both_calls(run):
    document = run(
        {"m.py": "def public():\n    _helper()\ndef _helper():\n    other()\ndef other(): ...\n"}
    )

    assert call_tuples(document) == [
        ("m.py::_helper", "m.py::other", "call"),
        ("m.py::public", "m.py::_helper", "call"),
    ]


def test_calls_in_nested_functions_and_comprehensions_belong_to_the_enclosing_member(run):
    document = run(
        {
            "m.py": (
                "def t(): ...\ndef f():\n    def inner():\n        t()\n"
                "    return [t() for _ in range(2)]\n"
            )
        }
    )

    assert {c["from"] for c in document["calls"]} == {"m.py::f"}


def test_calls_in_class_bodies_decorators_and_module_level_have_no_caller(run):
    document = run(
        {
            "m.py": (
                "def t(): ...\n"
                "t()\n"
                "class C:\n    x = t()\n"
                "@t\ndef f(): ...\n"
                "def g():\n    class Inner:\n        def m(self):\n            t()\n"
            )
        }
    )

    assert document["calls"] == []


def test_dispatch_skips_inheriting_subclasses_and_reaches_deeper_definitions(run):
    document = run(
        {
            "base.py": (
                "from abc import ABC, abstractmethod\nclass B(ABC):\n"
                "    @abstractmethod\n    def run(self): ...\n"
            ),
            "mid.py": "from base import B\nclass M(B):\n    pass\n",
            "leaf.py": "from mid import M\nclass L(M):\n    def run(self): ...\n",
        }
    )

    assert call_tuples(document) == [("base.py::B.run", "leaf.py::L.run", "dispatch")]


def test_dispatch_does_not_start_from_an_abc_method_without_abstractmethod(run):
    document = run(
        {
            "base.py": "from abc import ABC\nclass B(ABC):\n    def run(self): ...\n",
            "impl.py": "from base import B\nclass I(B):\n    def run(self): ...\n",
        }
    )

    assert document["calls"] == []


def test_dispatch_line_is_the_abstract_definition_line(run):
    document = run(
        {
            "base.py": (
                "from typing import Protocol\nclass P(Protocol):\n\n    def run(self): ...\n"
            ),
            "impl.py": "from base import P\nclass I(P):\n    def run(self): ...\n",
        }
    )

    assert [(c["line"], c["how"]) for c in document["calls"]] == [(4, "dispatch")]


def test_calls_are_sorted_and_deduplicated(run):
    document = run({"m.py": "def a(): ...\ndef b(): ...\ndef z():\n    b(); b()\n    a()\n"})

    assert [(c["to"], c["line"]) for c in document["calls"]] == [("m.py::b", 4), ("m.py::a", 5)]


def test_a_module_id_with_a_double_colon_has_no_calls(run):
    document = run({"a::b.py": "def f(): ...\ndef g():\n    f()\n"})

    assert document["calls"] == []


def test_no_python_means_an_empty_calls_list(run):
    assert run({"m.py": "x = 1\n"})["calls"] == []
