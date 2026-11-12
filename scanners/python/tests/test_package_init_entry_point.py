def marked(document: dict) -> list[str]:
    return sorted(m["id"] for m in document["modules"] if m.get("entry_point"))


TREE = {
    "pkg/__init__.py": "",
    "pkg/sub/__init__.py": "",
    "pkg/sub/leaf.py": "x = 1\n",
    "app.py": "from pkg.sub import leaf\n",
    "dead/__init__.py": "",
    "dead/x.py": "x = 1\n",
}


def test_an_import_into_a_package_marks_every_init_above_the_target(run):
    found = marked(run(TREE))

    assert found
    assert "pkg/__init__.py" in found
    assert "pkg/sub/__init__.py" in found


def test_a_package_nothing_loads_stays_unmarked(run):
    found = marked(run(TREE))

    assert found
    assert "dead/__init__.py" not in found


def test_a_test_imports_record_loads_the_package(run):
    document = run(
        {
            "pkg/__init__.py": "",
            "pkg/leaf.py": "x = 1\n",
            "tests/test_leaf.py": "from pkg import leaf\n",
        }
    )
    found = marked(document)

    assert document["test_imports"]
    assert "pkg/__init__.py" in found


def test_an_entry_module_inside_the_package_loads_it(run):
    found = marked(run({"pkg/__init__.py": "", "pkg/__main__.py": "x = 1\n"}))

    assert "pkg/__main__.py" in found
    assert "pkg/__init__.py" in found


def test_a_script_target_inside_the_package_loads_it(run):
    document = run(
        {
            "pyproject.toml": '[project.scripts]\ntool = "pkg.cli:main"\n',
            "pkg/__init__.py": "",
            "pkg/cli.py": "def main():\n    pass\n",
        }
    )

    assert "pkg/__init__.py" in marked(document)


def test_an_init_importing_its_own_submodules_is_not_marked(run):
    found = marked(
        run(
            {
                "pkg/__init__.py": "from pkg import leaf\n",
                "pkg/leaf.py": "x = 1\n",
                "other.py": "x = 1\n",
            }
        )
    )

    assert found == []


def test_a_module_inside_the_package_importing_a_sibling_does_not_load_it(run):
    found = marked(
        run(
            {
                "pkg/__init__.py": "",
                "pkg/a.py": "from pkg import b\n",
                "pkg/b.py": "x = 1\n",
            }
        )
    )

    assert found == []


def test_a_top_level_init_is_never_marked_by_the_load_rule(run):
    found = marked(run({"__init__.py": "", "a.py": "x = 1\n", "b.py": "import a\n"}))

    assert "__init__.py" not in found
