import json

from conftest import REPOSITORY, build_tree, validate

from recognizer_scan_python import scan


def test_skipped_directories_and_files_are_left_out(tmp_path):
    build_tree(
        tmp_path,
        {
            "keep/a.py": "",
            "b.py": "",
            ".venv/x.py": "",
            "myenv/pyvenv.cfg": "",
            "myenv/y.py": "",
            "__pycache__/c.py": "",
            "tests/d.py": "",
            "dist/e.py": "",
            "build/f.py": "",
            "node_modules/g.py": "",
            "x.egg-info/h.py": "",
            ".hidden/i.py": "",
            "keep/test_a.py": "",
            "keep/a_test.py": "",
            "keep/a_tests.py": "",
            "keep/conftest.py": "",
        },
    )
    document = scan(tmp_path, ["."], None)

    assert [m["id"] for m in document["modules"]] == ["b.py", "keep/a.py"]
    validate(document)


def test_skipped_project_module_import_is_foreign(tmp_path):
    build_tree(tmp_path, {"a.py": "import tests.helpers\n", "tests/helpers.py": ""})
    document = scan(tmp_path, ["."], None)

    assert [f["id"] for f in document["foreign"]] == ["foreign:tests"]


def test_files_equal_the_shared_selection_parity_tree(tmp_path):
    parity = json.loads((REPOSITORY / "fixtures" / "selection-parity.json").read_text())["python"]
    build_tree(tmp_path, dict.fromkeys(parity["tree"], ""))

    assert [f["path"] for f in scan(tmp_path, ["."], None)["files"]] == parity["accepted"]
