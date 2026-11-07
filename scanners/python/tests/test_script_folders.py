import json
from importlib.metadata import version

from conftest import REPOSITORY, build_tree, call_tuples, edge_tuples, validate

from recognizer_scan_python import scan

SCRIPT_FOLDER = REPOSITORY / "fixtures" / "python" / "script-folder"


def detect(tmp_path, files: dict[str, str]) -> dict:
    build_tree(tmp_path, files)
    document = scan(tmp_path, None, None)
    validate(document)

    return document


def foreign_names(document: dict) -> list[str]:
    return sorted(f["name"] for f in document["foreign"])


def test_sibling_import_and_from_import_resolve(tmp_path):
    document = detect(
        tmp_path,
        {
            "scripts/helper.py": "def go(): ...\n",
            "scripts/run.py": "import helper\nfrom helper import go\n",
        },
    )

    assert edge_tuples(document, "scripts/run.py") == [
        ("scripts/run.py", "scripts/helper.py", "depends", 1, None, None),
        ("scripts/run.py", "scripts/helper.py", "depends", 2, None, None),
    ]
    assert next(e for e in document["edges"] if e["line"] == 2)["names"] == ["go"]
    assert document["foreign"] == []


def test_sibling_call_and_base_resolve(tmp_path):
    document = detect(
        tmp_path,
        {
            "scripts/helper.py": "class Base: ...\ndef go(): ...\n",
            "scripts/run.py": (
                "import helper\nclass Child(helper.Base): ...\ndef main():\n    helper.go()\n"
            ),
        },
    )

    assert call_tuples(document) == [("scripts/run.py::main", "scripts/helper.py::go", "call")]
    assert ("scripts/run.py", "scripts/helper.py", "inherits", 2, "Child", "Base") in edge_tuples(
        document
    )


def test_sibling_package_resolves_deeply(tmp_path):
    document = detect(
        tmp_path,
        {
            "scripts/lib/__init__.py": "",
            "scripts/lib/sub/__init__.py": "",
            "scripts/lib/sub/deep.py": "X = 1\n",
            "scripts/run.py": "import lib.sub.deep\n",
        },
    )

    assert edge_tuples(document, "scripts/run.py") == [
        ("scripts/run.py", "scripts/lib/sub/deep.py", "depends", 1, None, None)
    ]


def test_package_module_never_gets_the_sibling_retry(tmp_path):
    document = detect(
        tmp_path,
        {
            "pkg/__init__.py": "",
            "pkg/typing.py": "X = 1\n",
            "pkg/app.py": "from typing import Any\n",
        },
    )

    assert edge_tuples(document, "pkg/app.py") == [
        ("pkg/app.py", "foreign:typing", "depends", 1, None, None)
    ]


def test_mixed_imports_resolve_only_the_sibling(tmp_path):
    document = detect(
        tmp_path,
        {
            "scripts/helper.py": "",
            "scripts/run.py": "import helper\nimport notmine\nimport typing\n",
        },
    )

    assert edge_tuples(document, "scripts/run.py") == [
        ("scripts/run.py", "scripts/helper.py", "depends", 1, None, None),
        ("scripts/run.py", "foreign:notmine", "depends", 2, None, None),
        ("scripts/run.py", "foreign:typing", "depends", 3, None, None),
    ]
    assert foreign_names(document) == ["notmine", "typing"]


def test_declared_root_wins_over_sibling(tmp_path):
    document = detect(
        tmp_path,
        {
            "src/pkg/__init__.py": "",
            "src/helper.py": "",
            "scripts/helper.py": "",
            "scripts/run.py": "import helper\n",
        },
    )

    assert edge_tuples(document, "scripts/run.py") == [
        ("scripts/run.py", "src/helper.py", "depends", 1, None, None)
    ]


def test_root_module_does_not_see_a_nested_helper(tmp_path):
    document = detect(tmp_path, {"scripts/helper.py": "", "top.py": "import helper\n"})

    assert edge_tuples(document, "top.py") == [
        ("top.py", "foreign:helper", "depends", 1, None, None)
    ]


def test_explicit_roots_get_no_sibling_retry(tmp_path):
    build_tree(tmp_path, {"scripts/helper.py": "", "scripts/run.py": "import helper\n"})
    document = scan(tmp_path, ["."], None)

    assert foreign_names(document) == ["helper"]


def test_sibling_only_the_importer_yields_no_self_edge(tmp_path):
    document = detect(tmp_path, {"scripts/run.py": "import run\n"})

    assert document["edges"] == []
    assert document["foreign"] == []


def test_script_folder_fixture_matches_expected_scan():
    actual = scan(SCRIPT_FOLDER / "sample", None, None)
    wanted = json.loads((SCRIPT_FOLDER / "expected-scan.json").read_text())

    wanted["scanner"]["version"] = version("recognizer-scan-python")

    assert actual == wanted
    validate(actual)


def test_real_content_scripts_resolve_their_common_helper():
    document = scan(REPOSITORY, None, None)
    common = "validation/mutation/common.py"

    for script in ("compare_python.py", "compare_typescript.py"):
        source = f"validation/mutation/{script}"
        targets = [e["to"] for e in document["edges"] if e["from"] == source]

        assert common in targets
        assert "foreign:common" not in targets
