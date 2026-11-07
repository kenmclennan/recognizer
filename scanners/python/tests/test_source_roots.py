import json
from importlib.metadata import version
from pathlib import Path

import pytest
from conftest import REPOSITORY, build_tree, validate
from test_fixture_and_cli import run_cli

from recognizer_scan_python import scan
from recognizer_scan_python.discovery import discover
from recognizer_scan_python.source_roots import detect_source_roots

SRC_LAYOUT = REPOSITORY / "fixtures" / "python" / "src-layout"


def detected(base: Path, files: dict[str, str]) -> list[str]:
    build_tree(base, files)

    return detect_source_roots(base, discover(base))


def targets(document: dict, source: str) -> list[str]:
    return sorted(e["to"] for e in document["edges"] if e["from"] == source)


@pytest.mark.parametrize(
    ("declaration_file", "declaration", "package"),
    [
        (
            "pyproject.toml",
            '[tool.setuptools]\npackage-dir = {"" = "lib"}\n',
            "lib/pkg/__init__.py",
        ),
        (
            "pyproject.toml",
            '[tool.setuptools]\npackage-dir = {"pkg" = "lib/pkg"}\n',
            "lib/pkg/__init__.py",
        ),
        (
            "pyproject.toml",
            '[tool.setuptools.packages.find]\nwhere = ["lib"]\n',
            "lib/pkg/__init__.py",
        ),
        (
            "pyproject.toml",
            '[tool.hatch.build.targets.wheel]\npackages = ["lib/pkg"]\n',
            "lib/pkg/__init__.py",
        ),
        (
            "pyproject.toml",
            '[tool.hatch.build.targets.wheel]\nsources = ["lib"]\n',
            "lib/pkg/__init__.py",
        ),
        (
            "pyproject.toml",
            '[tool.hatch.build.targets.wheel.sources]\n"lib" = ""\n',
            "lib/pkg/__init__.py",
        ),
        ("setup.cfg", "[options]\npackage_dir =\n    =lib\n", "lib/pkg/__init__.py"),
        ("setup.cfg", "[options]\npackage_dir =\n    pkg=lib/pkg\n", "lib/pkg/__init__.py"),
        ("setup.cfg", "[options.packages.find]\nwhere = lib\n", "lib/pkg/__init__.py"),
    ],
)
def test_each_declaration_form_yields_its_root(tmp_path, declaration_file, declaration, package):
    assert detected(tmp_path, {declaration_file: declaration, package: ""}) == ["lib", "."]


def test_bare_src_package_needs_no_declaration(tmp_path):
    assert detected(tmp_path, {"src/pkg/__init__.py": ""}) == ["src", "."]


def test_nested_src_package_yields_nested_root(tmp_path):
    assert detected(tmp_path, {"scanners/foo/src/foo/__init__.py": ""}) == [
        "scanners/foo/src",
        ".",
    ]


def test_flat_repository_yields_only_the_root(tmp_path):
    assert detected(tmp_path, {"pkg/__init__.py": "", "a.py": ""}) == ["."]


@pytest.mark.parametrize(
    "declaration",
    [
        '[tool.setuptools]\npackage-dir = {"" = "missing"}\n',
        '[tool.setuptools]\npackage-dir = {"" = "../outside"}\n',
        '[tool.setuptools]\npackage-dir = {"" = "/abs"}\n',
        "[tool.setuptools\nnot toml",
        "tool = 3\n",
    ],
)
def test_unusable_declaration_yields_root_and_scan_succeeds(tmp_path, declaration):
    build_tree(tmp_path, {"pyproject.toml": declaration, "a.py": "import os\n"})

    assert detect_source_roots(tmp_path, discover(tmp_path)) == ["."]
    assert targets(scan(tmp_path, None, None), "a.py") == ["foreign:os"]


def test_declared_roots_precede_src_roots_precede_root(tmp_path):
    files = {
        "pyproject.toml": '[tool.setuptools]\npackage-dir = {"" = "lib"}\n',
        "lib/a/__init__.py": "",
        "src/b/__init__.py": "",
    }

    assert detected(tmp_path, files) == ["lib", "src", "."]


def test_name_under_declared_root_beats_the_same_name_at_root(tmp_path):
    build_tree(
        tmp_path,
        {
            "pyproject.toml": '[tool.setuptools]\npackage-dir = {"" = "src"}\n',
            "pkg/__init__.py": "",
            "src/pkg/__init__.py": "",
            "use.py": "import pkg\n",
        },
    )

    assert targets(scan(tmp_path, None, None), "use.py") == ["src/pkg/__init__.py"]


def test_mixed_resolution_keeps_partial_result(tmp_path):
    build_tree(
        tmp_path,
        {
            "src/pkg/__init__.py": "",
            "src/pkg/a.py": "",
            "use.py": "import pkg.a\nimport os\nimport notmine\n",
        },
    )

    document = scan(tmp_path, None, None)
    validate(document)

    assert targets(document, "use.py") == ["foreign:notmine", "foreign:os", "src/pkg/a.py"]
    assert sorted(f["id"] for f in document["foreign"]) == ["foreign:notmine", "foreign:os"]


def test_explicit_roots_win_over_detection():
    document = scan(SRC_LAYOUT / "sample", ["."], None)

    assert "foreign:shop" in [f["id"] for f in document["foreign"]]


def test_cli_explicit_root_keeps_foreign_and_no_flag_resolves(tmp_path):
    sample = str(SRC_LAYOUT / "sample")
    explicit = tmp_path / "explicit.json"
    default = tmp_path / "default.json"

    assert run_cli(sample, "--source-root", ".", "--output", str(explicit)).returncode == 0
    assert run_cli(sample, "--output", str(default)).returncode == 0
    assert "foreign:shop" in [f["id"] for f in json.loads(explicit.read_text())["foreign"]]
    assert json.loads(default.read_text())["foreign"] == []


def test_cli_explicit_missing_root_still_exits_two():
    result = run_cli(str(SRC_LAYOUT / "sample"), "--source-root", "nowhere")

    assert result.returncode == 2


def test_src_layout_fixture_matches_expected_scan():
    actual = scan(SRC_LAYOUT / "sample", None, None)
    wanted = json.loads((SRC_LAYOUT / "expected-scan.json").read_text())

    wanted["scanner"]["version"] = version("recognizer-scan-python")

    assert actual == wanted
    validate(actual)
    assert not any("foreign:shop" in (e["to"], e["from"]) for e in actual["edges"])
    assert {
        "from": "tests/test_views.py",
        "to": "src/shop/views.py",
        "names": ["render"],
    } in actual["test_imports"]


def test_this_repository_resolves_its_own_packages():
    document = scan(REPOSITORY, None, None)
    ids = discover(REPOSITORY)

    roots = detect_source_roots(REPOSITORY, ids)

    assert [
        "scanners/csharp/src",
        "scanners/kotlin/src",
        "scanners/python/src",
        "sensors/src",
    ] == [r for r in roots[:-1] if not r.startswith("fixtures/")]
    assert roots[-1] == "."
    assert not [e for e in document["edges"] if e["to"].startswith("foreign:recognizer_")]
    assert document["test_imports"]
