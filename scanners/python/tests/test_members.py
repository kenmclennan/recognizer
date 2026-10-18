from conftest import module


def members(document, module_id):
    return [
        (m["name"], m["kind"], m["line"], m["exported"])
        for m in module(document, module_id)["members"]
    ]


def test_public_private_async_and_decorated(run):
    document = run(
        {
            "m.py": (
                "class A: ...\n"
                "class _B: ...\n"
                "async def c(): ...\n"
                "@staticmethod\n"
                "def d(): ...\n"
                "def _e(): ...\n"
            )
        }
    )

    assert members(document, "m.py") == [
        ("A", "class", 1, True),
        ("c", "function", 3, True),
        ("d", "function", 5, True),
    ]


def test_definitions_inside_if_and_try_are_not_members(run):
    document = run(
        {
            "m.py": (
                "if True:\n    def a(): ...\ntry:\n    class B: ...\nexcept Exception:\n    pass\n"
            )
        }
    )

    assert members(document, "m.py") == []


def test_all_forms(run):
    files = {
        "list_.py": "__all__ = ['a']\ndef a(): ...\ndef b(): ...\n",
        "tuple_.py": "__all__ = ('a',)\ndef a(): ...\ndef b(): ...\n",
        "annotated.py": "__all__: list[str] = ['a']\ndef a(): ...\ndef b(): ...\n",
        "computed.py": "__all__ = ['a'] + ['b']\ndef a(): ...\ndef b(): ...\n",
        "absent.py": "def a(): ...\ndef b(): ...\n",
        "twice.py": "__all__ = ['a']\n__all__ = ['b']\ndef a(): ...\ndef b(): ...\n",
        "private.py": "__all__ = ['_a']\ndef _a(): ...\ndef b(): ...\n",
    }
    document = run(files)

    for name in ("list_", "tuple_", "annotated"):
        assert [m[3] for m in members(document, f"{name}.py")] == [True, False]

    for name in ("computed", "absent", "twice"):
        assert [m[3] for m in members(document, f"{name}.py")] == [True, True]

    assert members(document, "private.py") == [("b", "function", 3, False)]


def test_module_kinds(run):
    document = run(
        {
            "only.py": "from typing import Protocol\nclass P(Protocol): ...\n",
            "pkg/__init__.py": "from typing import Protocol\nclass P(Protocol): ...\n",
            "mixed.py": "from typing import Protocol\nclass P(Protocol): ...\ndef f(): ...\n",
            "plain/__init__.py": "def f(): ...\n",
            "empty/__init__.py": "",
            "regular.py": "class A: ...\n",
        }
    )
    kinds = {m["id"]: m["kind"] for m in document["modules"]}

    assert kinds == {
        "only.py": "interface",
        "pkg/__init__.py": "interface",
        "mixed.py": "module",
        "plain/__init__.py": "package",
        "empty/__init__.py": "package",
        "regular.py": "module",
    }
