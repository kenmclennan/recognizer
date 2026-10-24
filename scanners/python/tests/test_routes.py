import json

from recognizer_scan_python import scan


def depends(document, source):
    return [
        (e["to"], e["line"], e.get("names"), e.get("via"))
        for e in document["edges"]
        if e["from"] == source and e["kind"] == "depends" and "inferred" not in e
    ]


def test_named_import_records_names(run):
    document = run({"a.py": "def f(): ...\n", "m.py": "from a import f\n"})

    assert depends(document, "m.py") == [("a.py", 1, ["f"], None)]


def test_alias_records_the_original_name(run):
    document = run({"a.py": "def f(): ...\n", "m.py": "from a import f as g\n"})

    assert depends(document, "m.py") == [("a.py", 1, ["f"], None)]


def test_whole_module_forms_carry_no_names(run):
    document = run(
        {
            "a/__init__.py": "",
            "a/b.py": "",
            "m.py": "import a.b\nfrom a import b\n",
            "n.py": "from a.b import *\n",
        }
    )

    assert depends(document, "m.py") == [("a/b.py", 1, None, None), ("a/b.py", 2, None, None)]
    assert depends(document, "n.py") == [("a/b.py", 1, None, None)]


def test_foreign_edge_carries_no_names(run):
    document = run({"m.py": "from os import path\n"})

    assert depends(document, "m.py") == [("foreign:os", 1, None, None)]


def test_one_hop_reexport_points_at_the_definer(run):
    document = run(
        {
            "p/__init__.py": "from .impl import X\n",
            "p/impl.py": "class X: ...\n",
            "m.py": "from p import X\n",
        }
    )

    assert depends(document, "m.py") == [("p/impl.py", 1, ["X"], ["p/__init__.py"])]


def test_two_hop_route_lists_every_step_in_order(run):
    document = run(
        {
            "p/__init__.py": "from .q import X\n",
            "p/q.py": "from .impl import X\n",
            "p/impl.py": "class X: ...\n",
            "m.py": "from p import X\n",
        }
    )

    assert depends(document, "m.py") == [("p/impl.py", 1, ["X"], ["p/__init__.py", "p/q.py"])]


def test_name_defined_in_the_barrel_stops_the_walk_there(run):
    document = run(
        {
            "p/__init__.py": "from .impl import X\nCOUNT = 1\n",
            "p/impl.py": "class X: ...\n",
            "m.py": "from p import COUNT\n",
        }
    )

    assert depends(document, "m.py") == [("p/__init__.py", 1, ["COUNT"], None)]


def test_name_both_defined_and_imported_is_defined(run):
    document = run(
        {
            "p/__init__.py": "from .impl import X\nclass X: ...\n",
            "p/impl.py": "class X: ...\n",
            "m.py": "from p import X\n",
        }
    )

    assert depends(document, "m.py") == [("p/__init__.py", 1, ["X"], None)]


def test_reexport_from_a_foreign_module_stays_on_the_barrel(run):
    document = run({"p/__init__.py": "from os import path\n", "m.py": "from p import path\n"})

    assert depends(document, "m.py") == [("p/__init__.py", 1, ["path"], None)]


def test_name_found_nowhere_falls_back_to_the_barrel(run):
    document = run({"p/__init__.py": "", "m.py": "from p import ghost\n"})

    assert depends(document, "m.py") == [("p/__init__.py", 1, ["ghost"], None)]


def test_star_reexport_is_followed_for_names_not_otherwise_defined(run):
    document = run(
        {
            "p/__init__.py": "from .impl import *\n",
            "p/impl.py": "class X: ...\n",
            "m.py": "from p import X\n",
        }
    )

    assert depends(document, "m.py") == [("p/impl.py", 1, ["X"], ["p/__init__.py"])]


def test_names_from_two_defining_modules_make_two_edges_on_one_line(run):
    document = run(
        {
            "p/__init__.py": "from .a import A\nfrom .b import B\n",
            "p/a.py": "class A: ...\n",
            "p/b.py": "class B: ...\n",
            "m.py": "from p import A, B\n",
        }
    )

    assert depends(document, "m.py") == [
        ("p/a.py", 1, ["A"], ["p/__init__.py"]),
        ("p/b.py", 1, ["B"], ["p/__init__.py"]),
    ]


def test_names_reaching_one_definer_by_two_routes_share_one_edge(run):
    document = run(
        {
            "p/__init__.py": "from .a import A\nfrom .mid import B\n",
            "p/mid.py": "from .a import B\n",
            "p/a.py": "class A: ...\nclass B: ...\n",
            "m.py": "from p import A, B\n",
        }
    )

    assert depends(document, "m.py") == [("p/a.py", 1, ["A", "B"], ["p/__init__.py", "p/mid.py"])]


def test_cycle_terminates_at_the_module_whose_next_hop_would_revisit(run):
    document = run(
        {
            "a.py": "from b import X\n",
            "b.py": "from a import X\n",
            "m.py": "from a import X\n",
        }
    )

    assert depends(document, "m.py") == [("b.py", 1, ["X"], ["a.py"])]


def test_partial_resolution_keeps_the_unresolved_name_on_the_barrel(run):
    document = run(
        {
            "p/__init__.py": "from .a import A\nfrom .b import B\n",
            "p/a.py": "class A: ...\n",
            "p/b.py": "class B: ...\n",
            "m.py": "from p import A, B, C\n",
        }
    )

    assert depends(document, "m.py") == [
        ("p/__init__.py", 1, ["C"], None),
        ("p/a.py", 1, ["A"], ["p/__init__.py"]),
        ("p/b.py", 1, ["B"], ["p/__init__.py"]),
    ]


def test_import_from_a_module_that_is_itself_gives_no_self_edge(run):
    document = run({"p/__init__.py": "from .impl import X\n", "p/impl.py": "from p import X\n"})

    assert depends(document, "p/impl.py") == []


def test_output_is_byte_identical_across_runs(tmp_path, run):
    files = {
        "p/__init__.py": "from .a import A\nfrom .b import B\n",
        "p/a.py": "class A: ...\n",
        "p/b.py": "class B: ...\n",
        "m.py": "from p import B, A\n",
    }
    first = json.dumps(run(files))

    assert json.dumps(scan(tmp_path, ["."], None)) == first
