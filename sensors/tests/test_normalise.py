import pytest

from recognizer_sensors.duplication.fingerprint import fingerprints
from recognizer_sensors.duplication.normalise import normalise
from recognizer_sensors.functions import find_functions
from recognizer_sensors.parsing import parse


def first_fingerprints(grammar: str, source: str) -> frozenset[int]:
    root = parse(grammar, source.encode()).root_node
    found = find_functions(root, grammar)

    assert found
    assert not found[0].node.has_error

    tree = normalise(found[0].node, set())

    assert tree is not None

    return fingerprints(tree)


PYTHON = """
def compute(items, rate):
    total = 0
    for item in items:
        if item.price > 0:
            total += helper(item.price) * 2
    return total + rate
"""

PYTHON_RENAMED = """
def other_name(lines, percent):
    amount = 0
    for line in lines:
        if line.cost > 0:
            amount += helper(line.cost) * 7
    return amount + percent
"""

PYTHON_CALL = PYTHON.replace("helper", "different")
PYTHON_OPERATOR = PYTHON.replace("+= ", "-= ")
PYTHON_ORDER = """
def compute(items, rate):
    for item in items:
        if item.price > 0:
            total += helper(item.price) * 2
    total = 0
    return total + rate
"""

TYPESCRIPT = """
function compute(items: Item[], rate: number): number {
  let total = 0;
  for (const item of items) {
    if (item.price > 0) {
      total += helper(item.price) * 2;
    }
  }
  return total + rate;
}
"""

TYPESCRIPT_RENAMED = """
function other(lines: Line[], percent: number): number {
  let amount = 0;
  for (const line of lines) {
    if (line.cost > 0) {
      amount += helper(line.cost) * 9;
    }
  }
  return amount + percent;
}
"""

KOTLIN = """
fun compute(items: List<Item>, rate: Int): Int {
    var total = 0
    for (item in items) {
        if (item.price > 0) {
            total += helper(item.price) * 2
        }
    }
    return total + rate
}
"""

KOTLIN_RENAMED = """
fun other(lines: List<Line>, percent: Int): Int {
    var amount = 0
    for (line in lines) {
        if (line.cost > 0) {
            amount += helper(line.cost) * 5
        }
    }
    return amount + percent
}
"""

RUST = """
fn compute(items: &[Item], rate: i32) -> i32 {
    let mut total = 0;
    for item in items {
        if item.price > 0 {
            total += helper(item.price) * 2;
        }
    }
    total + rate
}
"""

RUST_RENAMED = """
fn other(lines: &[Line], percent: i32) -> i32 {
    let mut amount = 0;
    for line in lines {
        if line.cost > 0 {
            amount += helper(line.cost) * 3;
        }
    }
    amount + percent
}
"""

CASES = {
    "python": (PYTHON, PYTHON_RENAMED),
    "typescript": (TYPESCRIPT, TYPESCRIPT_RENAMED),
    "tsx": (TYPESCRIPT, TYPESCRIPT_RENAMED),
    "kotlin": (KOTLIN, KOTLIN_RENAMED),
    "rust": (RUST, RUST_RENAMED),
}


@pytest.mark.parametrize("grammar", CASES)
def test_renaming_names_and_literals_keeps_the_fingerprints(grammar):
    original, renamed = CASES[grammar]

    assert first_fingerprints(grammar, original) == first_fingerprints(grammar, renamed)


@pytest.mark.parametrize("grammar", CASES)
def test_changing_a_called_name_changes_the_fingerprints(grammar):
    original, _ = CASES[grammar]

    assert first_fingerprints(grammar, original) != first_fingerprints(
        grammar, original.replace("helper", "different")
    )


@pytest.mark.parametrize("grammar", CASES)
def test_changing_an_operator_changes_the_fingerprints(grammar):
    original, _ = CASES[grammar]

    assert first_fingerprints(grammar, original) != first_fingerprints(
        grammar, original.replace("total +=", "total -=")
    )


def test_changing_the_statement_order_changes_the_fingerprints_in_python():
    assert first_fingerprints("python", PYTHON) != first_fingerprints("python", PYTHON_ORDER)


def test_changing_the_statement_order_changes_the_fingerprints_in_typescript():
    reordered = TYPESCRIPT.replace("  let total = 0;\n", "").replace(
        "  return total + rate;", "  let total = 0;\n  return total + rate;"
    )

    assert first_fingerprints("typescript", TYPESCRIPT) != first_fingerprints(
        "typescript", reordered
    )


def test_changing_the_statement_order_changes_the_fingerprints_in_kotlin():
    reordered = KOTLIN.replace("    var total = 0\n", "").replace(
        "    return total + rate", "    var total = 0\n    return total + rate"
    )

    assert first_fingerprints("kotlin", KOTLIN) != first_fingerprints("kotlin", reordered)


def test_changing_the_statement_order_changes_the_fingerprints_in_rust():
    reordered = RUST.replace("    let mut total = 0;\n", "").replace(
        "    total + rate", "    let mut total = 0;\n    total + rate"
    )

    assert first_fingerprints("rust", RUST) != first_fingerprints("rust", reordered)


def test_the_unused_call_and_operator_variants_differ():
    assert first_fingerprints("python", PYTHON) != first_fingerprints("python", PYTHON_CALL)
    assert first_fingerprints("python", PYTHON) != first_fingerprints("python", PYTHON_OPERATOR)


def test_comments_are_dropped():
    commented = PYTHON.replace("    total = 0\n", "    total = 0  # start\n")

    assert first_fingerprints("python", PYTHON) == first_fingerprints("python", commented)


def test_a_member_call_keeps_its_final_name():
    one = "def f(a):\n    return a.first(1)\n"
    two = "def f(a):\n    return a.second(1)\n"

    assert first_fingerprints("python", one) != first_fingerprints("python", two)
