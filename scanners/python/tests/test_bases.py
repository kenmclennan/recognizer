from conftest import edge_tuples


def bases(document, source):
    return [e for e in edge_tuples(document, source) if e[2] != "depends"]


STORE = "from typing import Protocol\nclass Store(Protocol): ...\n"


def test_project_class_base_is_inherits(run):
    document = run({"a.py": "class A: ...\n", "b.py": "from a import A\nclass B(A): ...\n"})

    assert bases(document, "b.py") == [("b.py", "a.py", "inherits", 2, "B", "A")]


def test_project_abstraction_base_is_implements(run):
    document = run(
        {
            "s.py": STORE,
            "abc_.py": "from abc import ABC\nclass Base(ABC): ...\n",
            "m.py": (
                "from s import Store\nfrom abc_ import Base\n"
                "class M(Store): ...\nclass N(Base): ...\n"
            ),
        }
    )

    assert [(e[1], e[2], e[4]) for e in bases(document, "m.py")] == [
        ("s.py", "implements", "M"),
        ("abc_.py", "implements", "N"),
    ]


def test_subscripted_bases_unwrap(run):
    document = run(
        {
            "a.py": "class Base: ...\n",
            "m.py": (
                "from typing import Protocol, TypeVar\nfrom a import Base\n"
                "T = TypeVar('T')\n"
                "class P(Protocol[T]): ...\nclass C(Base[int]): ...\n"
            ),
        }
    )

    assert [e[2] for e in bases(document, "m.py")] == ["inherits"]
    assert next(m for m in document["modules"] if m["id"] == "m.py")["members"][0]["kind"] == (
        "interface"
    )


def test_metaclass_abcmeta_marks_abstraction(run):
    document = run(
        {
            "s.py": "from abc import ABCMeta\nclass S(metaclass=ABCMeta): ...\n",
            "m.py": "from s import S\nclass M(S): ...\n",
        }
    )

    assert bases(document, "m.py")[0][2] == "implements"


def test_dotted_base_through_import_forms(run):
    document = run(
        {
            "pkg/__init__.py": "",
            "pkg/mod.py": "class Base: ...\n",
            "x.py": "import pkg.mod\nclass X(pkg.mod.Base): ...\n",
            "y.py": "from pkg import mod\nclass Y(mod.Base): ...\n",
        }
    )

    assert bases(document, "x.py")[0][1:3] == ("pkg/mod.py", "inherits")
    assert bases(document, "y.py")[0][1:3] == ("pkg/mod.py", "inherits")


def test_aliased_import_reports_original_name(run):
    document = run(
        {"a.py": "class A: ...\n", "m.py": "from a import A as Alias\nclass M(Alias): ...\n"}
    )

    assert bases(document, "m.py")[0][5] == "A"


def test_reexported_base_points_at_package_as_inherits(run):
    document = run(
        {
            "p/__init__.py": "from p.impl import Base\n",
            "p/impl.py": "class Base: ...\n",
            "m.py": "from p import Base\nclass M(Base): ...\n",
        }
    )

    assert bases(document, "m.py") == [("m.py", "p/__init__.py", "inherits", 2, "M", "Base")]


def test_no_edge_for_same_module_call_or_foreign_bases(run):
    document = run(
        {
            "m.py": (
                "class A: ...\nclass B(A): ...\nclass C(make()): ...\nclass E(Exception): ...\n"
                "def make(): ...\n"
            )
        }
    )

    assert document["edges"] == []


def test_two_project_bases_give_two_edges(run):
    document = run(
        {
            "a.py": "class A: ...\n",
            "b.py": "class B: ...\n",
            "m.py": "from a import A\nfrom b import B\nclass M(A, B): ...\n",
        }
    )

    assert [(e[1], e[5]) for e in bases(document, "m.py")] == [("a.py", "A"), ("b.py", "B")]
