import itertools
import json
import random

import pytest
from conftest import make_repository

from recognizer_sensors.duplication.functions import find_functions
from recognizer_sensors.duplication.normalise import count_nodes
from recognizer_sensors.duplication.score import brute_force_pairs, pruned_pairs, reaches
from recognizer_sensors.duplication.sensor import SettingsError, parse_settings, run
from recognizer_sensors.parsing import parse
from recognizer_sensors.scans import read_scans

BODY = """
def {name}({a}, {b}):
    {c} = 0
    for {d} in {a}:
        if {d}.price > 0:
            {c} += {d}.price * {d}.quantity
    return {c} + {b}
"""


def python_function(name: str, extra: str = "") -> str:
    return BODY.format(name=name, a="items", b="rate", c="total", d="item") + extra


def find(root, **settings):
    return run(root, read_scans(root), parse_settings(settings))


def test_the_threshold_comparison_is_at_or_above():
    assert reaches(41, 50, 0.82)
    assert not reaches(40, 50, 0.82)


def test_a_zero_union_never_reaches():
    assert not reaches(0, 0, 0.5)


def test_the_size_gate_on_lines(tmp_path):
    root = make_repository(
        tmp_path,
        {
            "a.py": "def f(x):\n    y = x + 1\n    z = y * 2\n    return z\n",
            "b.py": "def g(x):\n    y = x + 1\n    z = y * 2\n    return z\n",
        },
    )

    assert len(find(root, min_nodes=1, min_lines=4)) == 1
    assert find(root, min_nodes=1, min_lines=5) == []


def test_the_size_gate_on_nodes(tmp_path):
    root = make_repository(tmp_path, {"a.py": python_function("f"), "b.py": python_function("g")})

    nodes = count_nodes(
        find_functions(parse("python", python_function("f").encode()).root_node, "python")[0].node
    )

    assert len(find(root, min_nodes=nodes)) == 1
    assert find(root, min_nodes=nodes + 1) == []


def test_functions_of_different_languages_are_never_scored(tmp_path):
    typescript = (
        "function f(items) {\n  let total = 0;\n  for (const item of items) {\n"
        "    total += item.price;\n  }\n  return total;\n}\n"
    )
    python = "def f(items):\n    total = 0\n    for item in items:\n        total += item.price\n    return total\n"
    root = make_repository(tmp_path, {"a.ts": typescript, "b.py": python})

    assert find(root, min_nodes=1, threshold=0.1) == []


def test_a_function_and_one_nested_in_it_are_never_scored(tmp_path):
    source = (
        "def outer(items):\n    total = 0\n    for item in items:\n        total += item\n"
        "    def inner(items):\n        total = 0\n        for item in items:\n"
        "            total += item\n        return total\n    return total\n"
    )
    root = make_repository(tmp_path, {"a.py": source})

    assert find(root, min_nodes=1, threshold=0.1) == []


def test_two_functions_in_one_module_give_one_finding_with_one_module(tmp_path):
    root = make_repository(
        tmp_path, {"a.py": python_function("first") + "\n\n" + python_function("second")}
    )
    findings = find(root)

    assert len(findings) == 1
    assert findings[0]["evidence"]["modules"] == ["a.py"]
    assert findings[0]["id"] == "duplication:a.py::first|a.py::second"


def test_two_functions_with_one_qualified_name_get_line_suffixes(tmp_path):
    source = (
        "class A:\n    def run(self, items):\n        total = 0\n        for item in items:\n"
        "            total += item.price\n        return total\n"
        "class A:\n    def run(self, items):\n        total = 0\n        for item in items:\n"
        "            total += item.price\n        return total\n"
    )
    root = make_repository(tmp_path, {"a.py": source})
    findings = find(root, min_nodes=1)

    assert [f["id"] for f in findings] == ["duplication:a.py::A.run@2|a.py::A.run@8"]


def test_a_duplicate_across_two_modules_lists_both(tmp_path):
    root = make_repository(tmp_path, {"b.py": python_function("f"), "a.py": python_function("g")})
    findings = find(root)

    assert findings[0]["evidence"]["modules"] == ["a.py", "b.py"]
    assert findings[0]["summary"] == "g in a.py is 100% similar to f in b.py"


def test_a_kotlin_module_is_a_directory(tmp_path):
    function = (
        "fun {n}(items: List<Item>): Int {{\n    var total = 0\n    for (item in items) {{\n"
        "        total += item.price\n    }}\n    return total\n}}\n"
    )
    root = make_repository(
        tmp_path,
        {"pkg/One.kt": function.format(n="one"), "pkg/Two.kt": function.format(n="two")},
    )
    findings = find(root, min_nodes=1)

    assert [f["id"] for f in findings] == ["duplication:pkg::one|pkg::two"]


def generated_sets(count: int, seed: int) -> list[frozenset[int]]:
    rng = random.Random(seed)
    base = [frozenset(rng.sample(range(120), 50)) for _ in range(count // 2)]
    near = []

    for original in base:
        edited = set(original)

        for value in rng.sample(sorted(edited), rng.randint(0, 12)):
            edited.discard(value)
            edited.add(rng.randrange(120, 400))

        near.append(frozenset(edited))

    return base + near


@pytest.mark.parametrize("seed", range(5))
@pytest.mark.parametrize("threshold", [0.5, 0.82, 0.95, 1.0])
def test_the_pruned_search_equals_brute_force(seed, threshold):
    sets = generated_sets(40, seed)

    assert pruned_pairs(sets, threshold) == sorted(brute_force_pairs(sets, threshold))


def test_the_pruned_search_equals_brute_force_over_the_fixture(sample):
    from recognizer_sensors.duplication.sensor import collect_units

    scans = read_scans(sample)
    units = list(
        itertools.chain.from_iterable(
            collect_units(sample, scan, parse_settings({}))
            for scan in scans
            if scan.language == "python"
        )
    )
    sets = [unit.fingerprints for unit in units]

    assert pruned_pairs(sets, 0.82) == sorted(brute_force_pairs(sets, 0.82))


def test_the_fixture_has_exactly_the_two_planted_findings(sample):
    findings = find(sample)

    assert [f["id"] for f in findings] == [
        "duplication:app/pricing.py::sum_with_levy|app/pricing.py::total_with_tax",
        "duplication:src/pricing.ts::sumWithLevy|src/pricing.ts::totalWithTax",
    ]


def test_the_fixture_findings_carry_their_evidence(sample):
    typescript = next(f for f in find(sample) if f["id"].startswith("duplication:src/"))

    assert typescript == {
        "id": "duplication:src/pricing.ts::sumWithLevy|src/pricing.ts::totalWithTax",
        "kind": "duplication",
        "severity": "warning",
        "principle": "Do not repeat yourself",
        "fix_pattern": "extract-shared-function",
        "summary": "sumWithLevy in src/pricing.ts is 100% similar to totalWithTax in src/pricing.ts",
        "evidence": {
            "modules": ["src/pricing.ts"],
            "members": [
                {
                    "module": "src/pricing.ts",
                    "name": "sumWithLevy",
                    "file": "src/pricing.ts",
                    "lines": [12, 21],
                },
                {
                    "module": "src/pricing.ts",
                    "name": "totalWithTax",
                    "file": "src/pricing.ts",
                    "lines": [1, 10],
                },
            ],
            "measures": {"similarity": 1.0},
        },
    }


def test_the_fixture_describe_functions_stay_below_the_gate_or_threshold(sample):
    assert json.dumps(find(sample)).count("describe") == 0


def test_defaults_and_validation():
    assert parse_settings({}) == {"threshold": 0.82, "min_lines": 4, "min_nodes": 20}
    assert list(parse_settings({"min_nodes": 3})) == ["threshold", "min_lines", "min_nodes"]

    for bad in (
        {"threshold": 2},
        {"threshold": 0},
        {"threshold": "x"},
        {"threshold": True},
        {"min_lines": 0},
        {"min_lines": 1.5},
        {"min_nodes": True},
        {"nonesuch": 1},
    ):
        with pytest.raises(SettingsError):
            parse_settings(bad)
