import pytest
from conftest import call_tuples, module


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


def test_definitions_inside_if_and_try_are_members(run):
    document = run(
        {
            "m.py": (
                "if True:\n    def a(): ...\ntry:\n    class B: ...\nexcept Exception:\n    pass\n"
            )
        }
    )

    assert members(document, "m.py") == [
        ("a", "function", 2, True),
        ("B", "class", 4, True),
    ]


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

    assert [m[3] for m in members(document, "computed.py")] == [True, True]
    assert [m[3] for m in members(document, "absent.py")] == [True, True]
    assert [m[3] for m in members(document, "twice.py")] == [False, True]

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


def test_constants_are_single_name_assignments_at_module_level(run):
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
        ("I", "constant"),
    ]


def test_end_line_for_function_method_decorated_function_and_one_liner(run):
    document = run(
        {
            "m.py": (
                "def plain(a):\n"
                "    b = a\n"
                "    return b\n"
                "\n"
                "@staticmethod\n"
                "def decorated():\n"
                "    return 1\n"
                "\n"
                "def one(): ...\n"
                "\n"
                "class C:\n"
                "    def method(self):\n"
                "        x = 1\n"
                "        return x\n"
            )
        }
    )

    by_name = {m["name"]: m for m in module(document, "m.py")["members"]}

    assert (by_name["plain"]["line"], by_name["plain"]["end_line"]) == (1, 3)
    assert (by_name["decorated"]["line"], by_name["decorated"]["end_line"]) == (6, 7)
    assert (by_name["one"]["line"], by_name["one"]["end_line"]) == (9, 9)

    method = by_name["C"]["methods"][0]

    assert (method["line"], method["end_line"]) == (12, 14)
    assert "end_line" not in by_name["C"]


def test_every_function_and_method_in_the_sample_ends_at_or_after_its_start():
    from conftest import FIXTURE_ROOT

    from recognizer_scan_python import scan

    document = scan(FIXTURE_ROOT, ["."], None)
    checked = 0

    for mod in document["modules"]:
        for member in mod["members"]:
            for item in [member, *member.get("methods", [])]:
                if member["kind"] == "function" or item is not member:
                    assert item["end_line"] >= item["line"]
                    checked += 1

    assert checked > 0


BLOCKS = {
    "if": "if x:\n    N = 1\n",
    "try": "try:\n    N = 1\nexcept E:\n    pass\n",
    "except": "try:\n    pass\nexcept E:\n    N = 1\n",
    "else": "try:\n    pass\nexcept E:\n    pass\nelse:\n    N = 1\n",
    "finally": "try:\n    pass\nfinally:\n    N = 1\n",
    "with": "with x:\n    N = 1\n",
    "for": "for i in x:\n    N = 1\n",
    "while": "while x:\n    N = 1\n",
    "match": "match x:\n    case 1:\n        N = 1\n",
}


@pytest.mark.parametrize("kind", sorted(BLOCKS))
def test_block_kinds_define_members(run, kind):
    document = run({"m.py": BLOCKS[kind]})

    assert [(m[0], m[1]) for m in members(document, "m.py")] == [("N", "constant")]


def test_function_and_class_bodies_define_no_members(run):
    document = run(
        {"m.py": "def f():\n    inner = 1\nclass K:\n    if y:\n        attr = 1\nkeep = 1\n"}
    )

    names = [m[0] for m in members(document, "m.py")]

    assert names == ["f", "K", "keep"]


def test_two_branches_record_first_definition(run):
    document = run(
        {
            "m.py": (
                "import sys\n"
                "from typing import TYPE_CHECKING\n"
                "if TYPE_CHECKING:\n"
                "    class Foo: ...\n"
                "    BAR = 1\n"
                "else:\n"
                "    Foo = object\n"
                "try:\n"
                "    import ssl\n"
                "except ImportError:\n"
                "    ssl = None\n"
                "    def helper(): ...\n"
                "else:\n"
                "    def helper(): ...\n"
                "finally:\n"
                "    _done = True\n"
                "with open('x') as f:\n"
                "    W = 1\n"
                "def top():\n"
                "    if x:\n"
                "        inner = 1\n"
                "class K:\n"
                "    if y:\n"
                "        attr = 1\n"
                "if sys.version_info >= (3,):\n"
                "    def over(): ...\n"
                "def over(): ...\n"
            )
        }
    )

    assert members(document, "m.py") == [
        ("Foo", "class", 4, True),
        ("BAR", "constant", 5, True),
        ("ssl", "constant", 11, True),
        ("helper", "function", 12, True),
        ("_done", "constant", 16, False),
        ("W", "constant", 18, True),
        ("top", "function", 19, True),
        ("K", "class", 22, True),
        ("over", "function", 27, True),
    ]


def test_top_level_duplicates_are_kept(run):
    document = run(
        {
            "m.py": (
                "@overload\ndef f(a: int): ...\n"
                "@overload\ndef f(a: str): ...\n"
                "@overload\ndef f(a: bytes): ...\n"
                "def f(a): ...\n"
            )
        }
    )

    assert [m[0] for m in members(document, "m.py")] == ["f", "f", "f", "f"]


def test_mixed_block_and_top_level_names(run):
    document = run({"m.py": ("if x:\n    both = 1\n    only_block = 1\nboth = 2\nonly_top = 3\n")})

    assert [(m[0], m[2]) for m in members(document, "m.py")] == [
        ("only_block", 3),
        ("both", 4),
        ("only_top", 5),
    ]


EXPORT_BODY = "def a(): ...\ndef b(): ...\n"


@pytest.mark.parametrize(
    ("prefix", "flags"),
    [
        ("__all__ = ['a']\n__all__ += ['b']\n", [True, True]),
        ("__all__ = ['a']\n__all__ += ['x']\n", [True, False]),
        ("__all__ = ('a',)\n__all__.extend(['x'])\n__all__.append('y')\n", [True, False]),
        ("__all__ = ('a',)\n__all__.extend(['b'])\n", [True, True]),
        ("__all__ = ['a']\n__all__.append('b')\n", [True, True]),
        ("__all__ = ['a'] + ['x']\n", [True, False]),
        ("__all__ = ['a']\n__all__ = ['b']\n", [False, True]),
        ("__all__ = []\n", [False, False]),
        ("__all__ = ['a']\nfor n in __all__:\n    pass\n", [True, False]),
        ("__all__ = ['a']\ndef f():\n    __all__ = ['b']\n", [True, False]),
        ("__all__: list[str]\n__all__ = ['a']\n", [True, False]),
    ],
)
def test_all_built_up_forms(run, prefix, flags):
    document = run({"m.py": prefix + EXPORT_BODY})

    exported = [m[3] for m in members(document, "m.py") if m[0] in ("a", "b")]

    assert exported == flags


@pytest.mark.parametrize(
    "prefix",
    [
        "__all__ = ['a']\n__all__ += other\n",
        "__all__ = ['a']\n__all__.remove('a')\n",
        "__all__ = ['a']\nif x:\n    __all__ += ['b']\n",
        "__all__ += ['a']\n",
        "__all__.append('a')\n",
        "__all__ = ['a']\n__all__ = __all__ + ['b']\n",
        "__all__ = ['a', *other]\n",
        "__all__ = ['a']\n__all__[0] = 'b'\n",
        "__all__ = ['a']\ndel __all__[0]\n",
        "__all__ = ['a']\n__all__.sort()\n",
        "__all__ = ['a']\n__all__.extend(other)\n",
        "__all__ = other\n",
    ],
)
def test_all_undefined_forms_fall_back_to_underscore_rule(run, prefix):
    document = run({"m.py": prefix + "def a(): ...\ndef _b(): ...\n"})

    exported = [m[3] for m in members(document, "m.py") if m[0] in ("a", "_b")]

    assert exported == [True, False]


def test_call_to_block_level_function_is_an_edge(run):
    document = run(
        {
            "m.py": (
                "try:\n    def SOCKS(): ...\nexcept ImportError:\n    pass\n"
                "def top():\n    SOCKS()\n"
            )
        }
    )

    assert call_tuples(document) == [("m.py::top", "m.py::SOCKS", "call")]


def test_block_level_protocol_scans(run):
    document = run(
        {
            "m.py": (
                "from typing import Protocol\n"
                "if True:\n"
                "    class P(Protocol):\n"
                "        def go(self): ...\n"
                "class Impl(P):\n"
                "    def go(self): ...\n"
            )
        }
    )

    kinds = {m[0]: m[1] for m in members(document, "m.py")}

    assert kinds["P"] == "interface"
