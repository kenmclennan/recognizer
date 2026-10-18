from conftest import edge_tuples


def deps(document, source):
    return [(e[1], e[3]) for e in edge_tuples(document, source) if e[2] == "depends"]


def test_import_resolves_to_longest_module_prefix(run):
    document = run({"a/__init__.py": "", "a/b.py": "", "m.py": "import a.b.c\n"})

    assert deps(document, "m.py") == [("a/b.py", 1)]


def test_from_import_of_submodule_and_of_function(run):
    document = run(
        {
            "a/__init__.py": "def f(): ...\n",
            "a/b.py": "",
            "m.py": "from a import b\n",
            "n.py": "from a import f\n",
        }
    )

    assert deps(document, "m.py") == [("a/b.py", 1)]
    assert deps(document, "n.py") == [("a/__init__.py", 1)]


def test_from_import_names_collapse_to_one_edge(run):
    document = run({"a.py": "", "m.py": "from a import x, y\n"})

    assert deps(document, "m.py") == [("a.py", 1)]


def test_relative_imports(run):
    document = run(
        {
            "p/__init__.py": "from . import x\nfrom .y import z\n",
            "p/x.py": "",
            "p/y.py": "",
            "p/q/__init__.py": "",
            "p/q/m.py": "from .. import x\nfrom . import w\nfrom ... import nope\n",
            "p/q/w.py": "",
            "p/plain.py": "from . import x\n",
        }
    )

    assert deps(document, "p/__init__.py") == [("p/x.py", 1), ("p/y.py", 2)]
    assert deps(document, "p/q/m.py") == [("p/x.py", 1), ("p/q/w.py", 2)]
    assert deps(document, "p/plain.py") == [("p/x.py", 1)]
    assert document["foreign"] == []


def test_nested_and_type_checking_imports(run):
    document = run(
        {
            "a.py": "",
            "b.py": "",
            "m.py": (
                "from typing import TYPE_CHECKING\n"
                "if TYPE_CHECKING:\n    import a\n"
                "def f():\n    import b\n"
            ),
        }
    )

    assert ("a.py", 3) in deps(document, "m.py")
    assert ("b.py", 5) in deps(document, "m.py")


def test_source_root_layout_keeps_ids_relative_to_root(run):
    document = run(
        {"src/pkg/__init__.py": "", "src/pkg/a.py": "", "src/pkg/b.py": "from pkg import a\n"},
        source_roots=["src"],
    )

    assert deps(document, "src/pkg/b.py") == [("src/pkg/a.py", 1)]


def test_package_wins_over_module_of_same_name(run):
    document = run({"a.py": "", "a/__init__.py": "", "m.py": "import a\n"})

    assert deps(document, "m.py") == [("a/__init__.py", 1)]
    assert "a.py" in [m["id"] for m in document["modules"]]


def test_self_import_and_future_import_yield_nothing(run):
    document = run({"a.py": "import a\nfrom __future__ import annotations\n"})

    assert document["edges"] == []
    assert document["foreign"] == []


def test_same_target_on_two_lines_gives_two_edges(run):
    document = run({"a.py": "", "m.py": "import a\nimport a\n"})

    assert deps(document, "m.py") == [("a.py", 1), ("a.py", 2)]


def test_mixed_project_stdlib_and_skipped_imports(run):
    document = run(
        {
            "a.py": "",
            "tests/helpers.py": "",
            "m.py": "import a\nimport os\nimport tests.helpers\nfrom .. import y\n",
        }
    )

    assert deps(document, "m.py") == [("a.py", 1), ("foreign:os", 2), ("foreign:tests", 3)]
    assert [f["id"] for f in document["foreign"]] == ["foreign:os", "foreign:tests"]


def test_foreign_ids_use_top_level_name(run):
    document = run({"m.py": "import os.path\nfrom os import path\n"})

    assert deps(document, "m.py") == [("foreign:os", 1), ("foreign:os", 2)]
    assert len(document["foreign"]) == 1


def test_star_import_edge_goes_to_module(run):
    document = run({"a.py": "", "m.py": "from a import *\n"})

    assert deps(document, "m.py") == [("a.py", 1)]
