import pytest

from recognizer_sensors.duplication.shapes import is_accessor_shape, is_constructor_shape
from recognizer_sensors.functions import find_functions
from recognizer_sensors.parsing import grammar_for, parse

CASES = [
    (
        "a.py",
        "class A:\n    def f(self, a, b):\n        self.a = a\n        self.b = 2\n",
        "constructor",
    ),
    ("a.py", "class A:\n    def f(self, a):\n        self.a = a + 1\n", None),
    ("a.py", "class A:\n    def f(self, a):\n        self.a = other\n", None),
    ("a.py", "class A:\n    def f(self, a):\n        self.a = a\n        self.run()\n", None),
    ("a.py", "class A:\n    def f(self, a):\n        self.a += a\n", None),
    ("a.py", 'class A:\n    def f(self):\n        return self.s["k"].get("x", None)\n', "accessor"),
    ("a.py", "class A:\n    def f(self):\n        return self.s\n", "accessor"),
    ("a.py", "class A:\n    def f(self, key):\n        return self.s.get(key)\n", None),
    ("a.py", "class A:\n    def f(self):\n        x = self.s\n        return x\n", None),
    ("a.py", "class A:\n    def f(self):\n        return self.s + 1\n", None),
    (
        "a.ts",
        "class A {\n  f(a: number) {\n    this.a = a;\n    this.b = 1;\n  }\n}\n",
        "constructor",
    ),
    ("a.ts", "class A {\n  f(a: number) {\n    this.a = a * 2;\n  }\n}\n", None),
    ("a.ts", 'class A {\n  f() {\n    return this.s["k"].get("x");\n  }\n}\n', "accessor"),
    ("a.ts", "class A {\n  f(k: string) {\n    return this.s.get(k);\n  }\n}\n", None),
    (
        "a.kt",
        "class A {\n    fun f(a: Int) {\n        this.a = a\n        this.b = 1\n    }\n}\n",
        "constructor",
    ),
    ("a.kt", "class A {\n    fun f(a: Int) {\n        this.a += a\n    }\n}\n", None),
    (
        "a.kt",
        'class A {\n    fun f(): Int {\n        return this.s.get("x")\n    }\n}\n',
        "accessor",
    ),
    ("a.kt", 'class A {\n    fun f(): Int = s["k"]\n}\n', "accessor"),
    ("a.kt", "class A {\n    fun f(k: String): Int = s.get(k)\n}\n", None),
    (
        "a.rs",
        "impl A {\n    fn f(a: i32, b: i32) -> Self {\n        Self { a, b: 1, c: b }\n    }\n}\n",
        "constructor",
    ),
    (
        "a.rs",
        "impl A {\n    fn f(a: i32) -> Self {\n        Self { a, b: other }\n    }\n}\n",
        None,
    ),
    (
        "a.rs",
        "impl A {\n    fn f(&mut self, a: i32) {\n        self.a = a;\n    }\n}\n",
        "constructor",
    ),
    ("a.rs", 'impl A {\n    fn f(&self) -> i32 {\n        self.s.get("x")\n    }\n}\n', "accessor"),
    ("a.rs", "impl A {\n    fn f(&self, k: i32) -> i32 {\n        self.s.get(k)\n    }\n}\n", None),
    (
        "a.rs",
        "impl A {\n    fn f(&self) -> i32 {\n        let x = self.s;\n        x\n    }\n}\n",
        None,
    ),
]


@pytest.mark.parametrize(("path", "source", "shape"), CASES)
def test_a_function_is_skipped_only_in_the_shape_it_has(path, source, shape):
    grammar = grammar_for(path)
    function = next(iter(find_functions(parse(grammar, source.encode()).root_node, grammar))).node

    assert is_constructor_shape(function) == (shape == "constructor")
    assert is_accessor_shape(function) == (shape == "accessor")
