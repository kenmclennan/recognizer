import pytest

from recognizer_sensors.mutation.sites import find_sites
from recognizer_sensors.parsing import parse


def sites(grammar: str, source: str) -> list[tuple[str, str]]:
    root = parse(grammar, source.encode()).root_node

    return [(s.operator, s.replacement) for s in find_sites(root, grammar)]


@pytest.mark.parametrize(
    ("grammar", "source", "expected"),
    [
        ("python", "x = a == b", [("==", "!=")]),
        ("python", "x = a != b", [("!=", "==")]),
        ("python", "x = a < b", [("<", "<=")]),
        ("python", "x = a <= b", [("<=", "<")]),
        ("python", "x = a > b", [(">", ">=")]),
        ("python", "x = a >= b", [(">=", ">")]),
        ("python", "x = a + b", [("+", "-")]),
        ("python", "x = a - b", [("-", "+")]),
        ("python", "x = a * b", [("*", "/")]),
        ("python", "x = a / b", [("/", "*")]),
        ("python", "x = a and b", [("and", "or")]),
        ("python", "x = a or b", [("or", "and")]),
        ("python", "x = True", [("True", "False")]),
        ("python", "x = False", [("False", "True")]),
        ("typescript", "const x = a == b;", [("==", "!=")]),
        ("typescript", "const x = a === b;", [("===", "!==")]),
        ("typescript", "const x = a !== b;", [("!==", "===")]),
        ("typescript", "const x = a && b;", [("&&", "||")]),
        ("typescript", "const x = a || b;", [("||", "&&")]),
        ("typescript", "const x = a ?? b;", [("??", "&&")]),
        ("typescript", "const x = a + b;", [("+", "-")]),
        ("typescript", "const x = true;", [("true", "false")]),
        ("tsx", "const x = a < b;", [("<", "<=")]),
        ("kotlin", "fun f(a: Int) = a > 1 && true", [(">", ">="), ("&&", "||"), ("true", "false")]),
        ("kotlin", "fun f(a: Int) = a * 2 - 1", [("*", "/"), ("-", "+")]),
        (
            "kotlin",
            "fun f(a: Boolean) = a || false",
            [("||", "&&"), ("false", "true")],
        ),
        ("kotlin", "fun f(a: Int) = a == 1", [("==", "!=")]),
        (
            "rust",
            "fn f(a: i32) -> bool { a >= 1 || false }",
            [(">=", ">"), ("||", "&&"), ("false", "true")],
        ),
        (
            "rust",
            "fn f(a: i32) -> bool { a == 1 && true }",
            [("==", "!="), ("&&", "||"), ("true", "false")],
        ),
    ],
)
def test_each_operator_has_one_replacement(grammar, source, expected):
    assert sites(grammar, source) == expected


def test_kotlin_multi_line_expression_yields_its_sites():
    source = "fun f(a: Int): Boolean {\n    return a > 1 &&\n        a < 9\n}\n"

    assert sites("kotlin", source) == [(">", ">="), ("&&", "||"), ("<", "<=")]


@pytest.mark.parametrize(
    ("grammar", "source"),
    [
        ("typescript", "const x: Array<number> = [];"),
        ("typescript", "function f<T>(a: Array<T>) { return a; }"),
        ("rust", "fn f() { let v: Vec<i32> = Vec::new(); }"),
        ("typescript", "const x = -a;"),
        ("python", "x = -a"),
        ("rust", "fn f(v: &i32) -> i32 { *v }"),
        ("python", "x = 'a == b and True'"),
        ("python", "x = f'{a + b}'"),
        ("python", "# a == b and True"),
        ("typescript", "// a == b && true"),
        ("typescript", "const x = `a == b`;"),
        ("kotlin", 'val x = "a == b && true"'),
        ("rust", 'fn f() { let x = "a == b"; }'),
    ],
)
def test_non_sites_yield_nothing(grammar, source):
    assert sites(grammar, source) == []


def test_a_typescript_template_substitution_is_skipped():
    assert sites("typescript", "const x = `v ${a + b}`;") == []


def test_not_is_removed_with_the_whitespace_up_to_its_operand():
    root = parse("python", b"x = not   y").root_node
    [site] = find_sites(root, "python")

    assert site.operator == "not"
    assert site.replacement == ""
    assert b"x = not   y"[site.start_byte : site.end_byte] == b"not   "


def test_sites_are_ordered_by_position():
    root = parse("python", b"x = (a + b) * c > d").root_node

    assert [s.operator for s in find_sites(root, "python")] == ["+", "*", ">"]
