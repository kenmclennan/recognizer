from conftest import build_tree, validate

from recognizer_scan_python import scan


def records(tmp_path, files):
    build_tree(tmp_path, files)
    document = scan(tmp_path, ["."], None)
    validate(document)

    return document["test_imports"]


def test_scan_with_no_test_files_writes_an_empty_list(tmp_path):
    assert records(tmp_path, {"a.py": "", "b.py": "import a\n"}) == []


def test_tests_and_conftest_are_read_for_the_modules_they_import(tmp_path):
    found = records(
        tmp_path,
        {
            "pkg/__init__.py": "",
            "pkg/order.py": "class Order: ...\n",
            "pkg/conftest.py": "from pkg import order\n",
            "tests/test_order.py": "from pkg.order import Order\n",
        },
    )

    assert found == [
        {"from": "pkg/conftest.py", "to": "pkg/order.py"},
        {"from": "tests/test_order.py", "to": "pkg/order.py", "names": ["Order"]},
    ]


def test_names_are_the_sorted_union_and_whole_module_import_omits_them(tmp_path):
    found = records(
        tmp_path,
        {
            "m.py": "def b(): ...\ndef a(): ...\n",
            "n.py": "def c(): ...\n",
            "tests/test_a.py": "from m import b\nfrom m import a\n",
            "tests/test_b.py": "from m import a\nimport m\n",
            "tests/test_c.py": "from n import c\nfrom n import c\n",
        },
    )

    assert found == [
        {"from": "tests/test_a.py", "to": "m.py", "names": ["a", "b"]},
        {"from": "tests/test_b.py", "to": "m.py"},
        {"from": "tests/test_c.py", "to": "n.py", "names": ["c"]},
    ]


def test_nested_test_directories_are_read_and_records_are_sorted(tmp_path):
    found = records(
        tmp_path,
        {
            "m.py": "",
            "n.py": "",
            "z/tests/unit/test_z.py": "import n\nimport m\n",
            "a/test/test_a.py": "import m\n",
        },
    )

    assert [(r["from"], r["to"]) for r in found] == [
        ("a/test/test_a.py", "m.py"),
        ("z/tests/unit/test_z.py", "m.py"),
        ("z/tests/unit/test_z.py", "n.py"),
    ]


def test_unparseable_test_file_contributes_nothing_and_the_scan_succeeds(tmp_path):
    found = records(
        tmp_path,
        {"m.py": "", "tests/test_bad.py": "def (:\n", "tests/test_ok.py": "import m\n"},
    )

    assert found == [{"from": "tests/test_ok.py", "to": "m.py"}]


def test_skipped_non_test_directories_and_foreign_packages_give_no_record(tmp_path):
    found = records(
        tmp_path,
        {
            "m.py": "",
            "build/m2.py": "",
            "build/tests/test_x.py": "import m\n",
            ".hidden/tests/test_y.py": "import m\n",
            "tests/test_z.py": "import m2\nimport requests\nimport build.m2\n",
        },
    )

    assert found == []


def test_test_files_stay_out_of_the_rest_of_the_scan(tmp_path):
    build_tree(tmp_path, {"m.py": "", "tests/test_m.py": "import m\n"})
    document = scan(tmp_path, ["."], None)

    assert [m["id"] for m in document["modules"]] == ["m.py"]
    assert [f["path"] for f in document["files"]] == ["m.py"]
    assert document["edges"] == []
