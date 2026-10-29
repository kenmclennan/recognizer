from conftest import module


def member(document, module_id, name):
    return next(m for m in module(document, module_id)["members"] if m["name"] == name)


def names(*found):
    return [{"name": name} for name in found]


def method(document, module_id, cls, name):
    return next(m for m in member(document, module_id, cls)["methods"] if m["name"] == name)


def test_bases_are_written_as_in_source(run):
    document = run(
        {
            "m.py": (
                "import abc\nfrom typing import Generic, TypeVar\nT = TypeVar('T')\n"
                "class A(abc.ABC, Generic[T], metaclass=abc.ABCMeta): ...\nclass B: ...\n"
            )
        }
    )

    assert member(document, "m.py", "A")["bases"] == ["abc.ABC", "Generic[T]"]
    assert member(document, "m.py", "B")["bases"] == []


def test_fields_come_from_the_class_body_and_init(run):
    document = run(
        {
            "m.py": (
                "class A:\n"
                "    x: int\n"
                "    y = 1\n"
                "    z: str = 'a'\n"
                "    def __init__(self, a):\n"
                "        self.a = a\n"
                "        self.b: list[int] = []\n"
                "        self.x = 2\n"
                "        self._c = 3\n"
            )
        }
    )

    assert member(document, "m.py", "A")["fields"] == [
        {"name": "x", "type": "int", "line": 2, "private": False},
        {"name": "y", "line": 3, "private": False},
        {"name": "z", "type": "str", "line": 4, "private": False},
        {"name": "a", "line": 6, "private": False},
        {"name": "b", "type": "list[int]", "line": 7, "private": False},
        {"name": "_c", "line": 9, "private": True},
    ]


def test_parameters_drop_self_and_cls_and_keep_every_other_form(run):
    document = run(
        {
            "m.py": (
                "class A:\n"
                "    def a(self, p, /, q, *args, k, **kwargs): ...\n"
                "    @classmethod\n"
                "    def b(cls, x): ...\n"
                "    @staticmethod\n"
                "    def c(self, y): ...\n"
                "def f(p, *a, k=1, **kw): ...\n"
            )
        }
    )

    assert method(document, "m.py", "A", "a")["params"] == names("p", "q", "args", "k", "kwargs")
    assert method(document, "m.py", "A", "b")["params"] == names("x")
    assert method(document, "m.py", "A", "c")["params"] == names("self", "y")
    assert member(document, "m.py", "f")["params"] == names("p", "a", "k", "kw")


def test_parameters_carry_their_annotation_and_nothing_inferred(run):
    document = run(
        {
            "m.py": (
                "class A:\n"
                "    def m(self, a: int, b, c=1, *args: str, d: 'A | None' = None, **kw): ...\n"
                "def f(x: list[int], y=2): ...\n"
            )
        }
    )

    assert method(document, "m.py", "A", "m")["params"] == [
        {"name": "a", "type": "int"},
        {"name": "b"},
        {"name": "c"},
        {"name": "args", "type": "str"},
        {"name": "d", "type": "'A | None'"},
        {"name": "kw"},
    ]
    assert member(document, "m.py", "f")["params"] == [
        {"name": "x", "type": "list[int]"},
        {"name": "y"},
    ]


def test_returns_only_when_declared(run):
    document = run(
        {
            "m.py": (
                "def f() -> list[int]: ...\ndef g(): ...\nclass A:\n"
                "    def h(self) -> 'A': ...\n    def i(self): ...\n"
            )
        }
    )

    assert member(document, "m.py", "f")["returns"] == "list[int]"
    assert "returns" not in member(document, "m.py", "g")
    assert method(document, "m.py", "A", "h")["returns"] == "'A'"
    assert "returns" not in method(document, "m.py", "A", "i")


def test_private_methods(run):
    document = run(
        {
            "m.py": (
                "class A:\n    def a(self): ...\n    def _b(self): ...\n"
                "    def __c(self): ...\n    def __init__(self): ...\n"
            )
        }
    )
    flags = {m["name"]: m["private"] for m in member(document, "m.py", "A")["methods"]}

    assert flags == {"a": False, "_b": True, "__c": True, "__init__": False}


def test_tags(run):
    document = run(
        {
            "m.py": (
                "import abc\nfrom abc import abstractmethod\n"
                "class A(abc.ABC):\n"
                "    @property\n    def p(self): ...\n"
                "    @p.setter\n    def p(self, v): ...\n"
                "    @staticmethod\n    def s(): ...\n"
                "    @classmethod\n    def c(cls): ...\n"
                "    @abc.abstractmethod\n    def a(self): ...\n"
                "    @abstractmethod\n    async def b(self): ...\n"
                "    def plain(self): ...\n"
                "async def f(): ...\n"
            )
        }
    )
    tags = {m["name"]: m.get("tags") for m in member(document, "m.py", "A")["methods"]}

    assert tags == {
        "p": ["property"],
        "s": ["static"],
        "c": ["classmethod"],
        "a": ["abstract"],
        "b": ["abstract", "async"],
        "plain": None,
    }
    assert [m["name"] for m in member(document, "m.py", "A")["methods"]].count("p") == 1
    assert member(document, "m.py", "f")["tags"] == ["async"]


def test_every_method_of_a_protocol_is_abstract(run):
    document = run(
        {
            "m.py": (
                "from typing import Protocol\nclass P(Protocol):\n"
                "    def a(self): ...\n    def b(self): ...\n"
            )
        }
    )

    assert all(m["tags"] == ["abstract"] for m in member(document, "m.py", "P")["methods"])


def test_constant_value_of_exactly_40_characters_is_kept_whole(run):
    text = "x" * 38
    document = run({"m.py": f'A = "{text}"\n'})
    value = member(document, "m.py", "A")["value"]

    assert len(value) == 40
    assert value == f'"{text}"'


def test_constant_value_of_41_characters_is_cut_to_39_plus_ellipsis(run):
    text = "x" * 39
    document = run({"m.py": f'A = "{text}"\n'})
    value = member(document, "m.py", "A")["value"]

    assert len(value) == 40
    assert value == f'"{text}"'[:39] + "…"


def test_constant_value_collapses_whitespace(run):
    document = run({"m.py": "A = [\n    1,\n    2,\n]\n"})

    assert member(document, "m.py", "A")["value"] == "[ 1, 2, ]"
