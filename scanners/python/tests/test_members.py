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
        ("_B", "class", 2, False),
        ("c", "function", 3, True),
        ("d", "function", 5, True),
        ("_e", "function", 6, False),
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

    assert members(document, "private.py") == [
        ("_a", "function", 2, True),
        ("b", "function", 3, False),
    ]


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


def test_protocol_and_private_function_is_still_an_interface_module(run):
    document = run(
        {
            "m.py": (
                "from typing import Protocol\nclass P(Protocol): ...\ndef _helper(): ...\n_Y = 2\n"
            )
        }
    )

    assert module(document, "m.py")["kind"] == "interface"


def test_underscore_and_dunder_names(run):
    document = run(
        {
            "m.py": (
                "__all__ = ['a']\n__version__ = '1'\n"
                "def a(): ...\ndef _b(): ...\ndef __c(): ...\ndef __d__(): ...\n"
                "class _K: ...\n_X = 1\n__Y = 2\n"
            )
        }
    )

    assert [(m[0], m[1], m[3]) for m in members(document, "m.py")] == [
        ("a", "function", True),
        ("_b", "function", False),
        ("__c", "function", False),
        ("_K", "class", False),
        ("_X", "constant", False),
        ("__Y", "constant", False),
    ]


def test_private_names_listed_in_all_are_exported(run):
    document = run({"m.py": "__all__ = ['_a', '_K']\ndef _a(): ...\nclass _K: ...\n"})

    assert [m[3] for m in members(document, "m.py")] == [True, True]


def test_constants_are_module_body_single_name_assignments(run):
    document = run(
        {
            "m.py": (
                "A = 1\nB: int = 2\nC: int\nD = E = 3\nF, G = 1, 2\nH.x = 3\nif True:\n    I = 1\n"
            )
        }
    )

    assert [(m[0], m[1]) for m in members(document, "m.py")] == [
        ("A", "constant"),
        ("B", "constant"),
    ]
