from pathlib import Path

from conftest import REPOSITORY, module

from recognizer_scan_python import scan


def project(scripts: str) -> str:
    return f'[project]\nname = "pkg"\nversion = "1"\n\n{scripts}\n'


def marked(document: dict) -> list[str]:
    return sorted(m["id"] for m in document["modules"] if m.get("entry_point"))


def test_script_target_marks_its_module(run):
    document = run(
        {
            "pyproject.toml": project('[project.scripts]\ntool = "pkg.cli:main"'),
            "pkg/__init__.py": "",
            "pkg/cli.py": "def main():\n    pass\n",
            "pkg/other.py": "x = 1\n",
        }
    )

    assert marked(document) == ["pkg/cli.py"]


def test_gui_script_marks_its_module(run):
    document = run(
        {
            "pyproject.toml": project('[project.gui-scripts]\ntool = "pkg.gui"'),
            "pkg/__init__.py": "",
            "pkg/gui.py": "x = 1\n",
        }
    )

    assert marked(document) == ["pkg/gui.py"]


def test_src_layout_marks_the_module_under_src(run):
    document = run(
        {
            "sub/pyproject.toml": project('[project.scripts]\ntool = "pkg.cli:main"'),
            "sub/src/pkg/__init__.py": "",
            "sub/src/pkg/cli.py": "def main():\n    pass\n",
        }
    )

    assert marked(document) == ["sub/src/pkg/cli.py"]


def test_package_target_marks_its_init(run):
    document = run(
        {
            "pyproject.toml": project('[project.scripts]\ntool = "pkg:main"'),
            "pkg/__init__.py": "def main():\n    pass\n",
            "pkg/cli.py": "x = 1\n",
        }
    )

    assert marked(document) == ["pkg/__init__.py"]


def test_unresolved_target_marks_nothing(run):
    document = run(
        {
            "pyproject.toml": project('[project.scripts]\ntool = "missing.cli:main"'),
            "pkg/__init__.py": "",
            "pkg/cli.py": "x = 1\n",
        }
    )

    assert marked(document) == []


def test_malformed_pyproject_marks_nothing_and_scan_succeeds(run):
    document = run(
        {
            "pyproject.toml": "[project\nscripts = ",
            "pkg/__init__.py": "",
            "pkg/cli.py": "x = 1\n",
        }
    )

    assert marked(document) == []


def test_pyproject_is_listed_in_files(run):
    document = run(
        {
            "sub/pyproject.toml": project('[project.scripts]\ntool = "pkg.cli:main"'),
            "sub/pkg/cli.py": "x = 1\n",
        }
    )

    assert "sub/pyproject.toml" in [f["path"] for f in document["files"]]


def test_only_resolving_targets_are_marked(run):
    document = run(
        {
            "pyproject.toml": project(
                '[project.scripts]\na = "pkg.cli:main"\nb = "pkg.gone:main"\nc = "pkg.cli.sub:x"'
            ),
            "pkg/__init__.py": "",
            "pkg/cli.py": "x = 1\n",
            "pkg/other.py": "x = 1\n",
        }
    )

    assert marked(document) == ["pkg/cli.py"]


def test_pyproject_under_a_skipped_directory_is_not_read(run):
    document = run(
        {
            "tests/pyproject.toml": project('[project.scripts]\ntool = "pkg.cli:main"'),
            "pkg/__init__.py": "",
            "pkg/cli.py": "x = 1\n",
        }
    )

    assert marked(document) == []


def test_real_csharp_scanner_cli_is_an_entry_point():
    document = scan(Path(REPOSITORY / "scanners" / "csharp"), None, None)

    assert module(document, "src/recognizer_scan_csharp/cli.py")["entry_point"] is True


def test_pyproject_without_scripts_is_listed_in_files(run):
    document = run(
        {
            "sub/pyproject.toml": project("[tool.other]\nx = 1"),
            "sub/pkg/cli.py": "x = 1\n",
        }
    )

    assert "sub/pyproject.toml" in [f["path"] for f in document["files"]]


def test_malformed_pyproject_is_not_listed_in_files(run):
    document = run({"sub/pyproject.toml": "[project\nscripts = ", "sub/a.py": "x = 1\n"})

    assert "sub/pyproject.toml" not in [f["path"] for f in document["files"]]


def test_selection_carries_the_pyproject_glob(run):
    document = run({"a.py": "x = 1\n"})

    assert document["selection"]["input_file_globs"] == ["pyproject.toml"]
