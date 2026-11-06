import itertools
import json
import random

import pytest
from conftest import make_repository

from recognizer_sensors.duplication.normalise import count_nodes
from recognizer_sensors.duplication.score import brute_force_pairs, pruned_pairs, reaches
from recognizer_sensors.duplication.sensor import SettingsError, families, parse_settings, run
from recognizer_sensors.functions import find_functions
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

    assert len(find(root, min_nodes=1, min_lines=4, pair_min_lines=4)) == 1
    assert find(root, min_nodes=1, min_lines=5, pair_min_lines=4) == []


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
    findings = find(root, min_nodes=1, pair_min_lines=4)

    assert [f["id"] for f in findings] == ["duplication:a.py::A.run@2|a.py::A.run@8"]


def test_a_duplicate_across_two_modules_lists_both(tmp_path):
    root = make_repository(tmp_path, {"b.py": python_function("f"), "a.py": python_function("g")})
    findings = find(root)

    assert findings[0]["evidence"]["modules"] == ["a.py", "b.py"]
    assert findings[0]["summary"] == "g in a.py is 100% similar to f in b.py"


def test_a_kotlin_module_is_a_file(tmp_path):
    function = (
        "fun {n}(items: List<Item>): Int {{\n    var total = 0\n    for (item in items) {{\n"
        "        total += item.price\n    }}\n    return total\n}}\n"
    )
    root = make_repository(
        tmp_path,
        {"pkg/One.kt": function.format(n="one"), "pkg/Two.kt": function.format(n="two")},
    )
    findings = find(root, min_nodes=1)

    assert [f["id"] for f in findings] == ["duplication:pkg/One.kt::one|pkg/Two.kt::two"]


def test_three_similar_functions_give_one_family_finding(tmp_path):
    root = make_repository(
        tmp_path,
        {
            "a.py": python_function("one"),
            "b.py": python_function("two"),
            "c.py": python_function("three"),
        },
    )
    findings = find(root)

    assert len(findings) == 1
    assert findings[0]["id"] == "duplication:a.py::one|b.py::two#3"
    assert findings[0]["summary"] == (
        "3 functions share one structure: one in a.py, two in b.py, three in c.py"
    )
    assert [m["name"] for m in findings[0]["evidence"]["members"]] == ["one", "two", "three"]
    assert findings[0]["evidence"]["modules"] == ["a.py", "b.py", "c.py"]
    assert findings[0]["evidence"]["measures"] == {"similarity": 1.0}


def test_two_similar_functions_keep_the_pair_finding(tmp_path):
    root = make_repository(
        tmp_path, {"a.py": python_function("one"), "b.py": python_function("two")}
    )
    findings = find(root)

    assert [f["id"] for f in findings] == ["duplication:a.py::one|b.py::two"]
    assert findings[0]["summary"] == "one in a.py is 100% similar to two in b.py"
    assert len(findings[0]["evidence"]["members"]) == 2


def test_a_fourth_similar_function_changes_the_family_id(tmp_path):
    files = {f"{n}.py": python_function(f"f_{n}") for n in "abc"}
    three = find(make_repository(tmp_path / "three", files))
    four = find(make_repository(tmp_path / "four", {**files, "d.py": python_function("f_d")}))

    assert three[0]["id"].endswith("#3")
    assert four[0]["id"] == "duplication:a.py::f_a|b.py::f_b#4"


def test_two_separate_families_in_one_file_give_two_findings(tmp_path):
    other = "def {name}(rows):\n    out = []\n    for row in rows:\n        out.append(row.name.upper())\n    return out\n"
    source = "\n\n".join(
        [python_function("a1"), python_function("a2"), python_function("a3")]
        + [other.format(name=n) for n in ("b1", "b2", "b3")]
    )
    root = make_repository(tmp_path, {"m.py": source})
    findings = find(root, min_nodes=1)

    assert sorted(f["id"] for f in findings) == [
        "duplication:m.py::a1|m.py::a2#3",
        "duplication:m.py::b1|m.py::b2#3",
    ]


def test_nested_functions_join_a_family_only_through_a_third_function(tmp_path):
    source = (
        "def outer(items):\n    total = 0\n    for item in items:\n        total += item\n"
        "    def inner(items):\n        total = 0\n        for item in items:\n"
        "            total += item\n        return total\n    return total\n"
    )
    root = make_repository(tmp_path, {"a.py": source, "b.py": python_function("other")})

    findings = find(root, min_nodes=1, threshold=0.1)

    assert [f["id"] for f in findings] == ["duplication:a.py::outer|a.py::outer.inner#3"]
    assert findings[0]["evidence"]["modules"] == ["a.py", "b.py"]


def test_a_chain_of_pairs_is_one_family_scored_by_its_weakest_edge():
    result = families([(0, 1, 0.9), (1, 2, 0.85), (5, 6, 0.95)])

    assert sorted(result) == [([0, 1, 2], 0.85), ([5, 6], 0.95)]


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
        "duplication:src/pricing.ts::sumWithLevy|src/pricing.ts::totalWithTax",
        "duplication:app/pricing.py::sum_with_levy|app/pricing.py::total_with_tax",
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
    assert parse_settings({}) == {
        "threshold": 0.82,
        "min_lines": 4,
        "pair_min_lines": 6,
        "min_nodes": 20,
    }
    assert list(parse_settings({"min_nodes": 3})) == [
        "threshold",
        "min_lines",
        "pair_min_lines",
        "min_nodes",
    ]

    for bad in (
        {"threshold": 2},
        {"threshold": 0},
        {"threshold": "x"},
        {"threshold": True},
        {"min_lines": 0},
        {"min_lines": 1.5},
        {"pair_min_lines": 0},
        {"pair_min_lines": 2.5},
        {"min_nodes": True},
        {"nonesuch": 1},
    ):
        with pytest.raises(SettingsError):
            parse_settings(bad)


def sized(name: str, lines: int) -> str:
    body = "".join(f"    v{i} = x + {i}\n" for i in range(lines - 2))

    return f"def {name}(x):\n{body}    return x\n"


def distinct(name: str, lines: int) -> str:
    body = "".join(f"    v{i} = x * {i}\n" for i in range(lines - 2))

    return f"def {name}(x):\n{body}    return x\n"


def method_class(name: str, methods: list[str], lines: int) -> str:
    body = "".join("    " + line + "\n" for m in methods for line in sized(m, lines).splitlines())

    return f"class {name}:\n{body}"


def test_a_five_line_pair_is_dropped_at_the_defaults_and_kept_when_lowered(tmp_path):
    root = make_repository(tmp_path, {"a.py": sized("f", 5), "b.py": sized("g", 5)})

    assert find(root, min_nodes=1) == []
    assert len(find(root, min_nodes=1, pair_min_lines=4)) == 1


def test_a_six_line_pair_is_kept(tmp_path):
    root = make_repository(tmp_path, {"a.py": sized("f", 6), "b.py": sized("g", 6)})

    assert len(find(root, min_nodes=1)) == 1


def test_a_pair_with_a_five_line_member_is_dropped(tmp_path):
    root = make_repository(tmp_path, {"a.py": sized("f", 6), "b.py": sized("g", 5)})

    assert find(root, min_nodes=1, threshold=0.5) == []


def test_a_family_of_three_five_line_functions_is_kept_at_the_defaults(tmp_path):
    files = {f"{n}.py": sized(n, 5) for n in ("a", "b", "c")}
    root = make_repository(tmp_path, files)

    found = find(root, min_nodes=1)

    assert len(found) == 1
    assert len(found[0]["evidence"]["members"]) == 3


def test_a_raised_min_lines_drops_a_seven_line_pair_and_family(tmp_path):
    pair = make_repository(tmp_path / "p", {"a.py": sized("f", 7), "b.py": sized("g", 7)})
    family = make_repository(tmp_path / "f", {f"{n}.py": sized(n, 7) for n in ("a", "b", "c")})

    assert find(pair, min_nodes=1, min_lines=8) == []
    assert find(family, min_nodes=1, min_lines=8) == []


def test_three_methods_of_one_class_get_the_class_summary(tmp_path):
    root = make_repository(tmp_path, {"a.py": method_class("C", ["f", "g", "h"], 5)})

    found = find(root, min_nodes=1)

    assert len(found) == 1
    assert found[0]["summary"] == "3 methods of C share one structure"
    assert len(found[0]["evidence"]["members"]) == 3
    assert found[0]["id"].endswith("#3")


def test_methods_across_two_classes_and_free_functions_keep_the_names_summary(tmp_path):
    split = make_repository(
        tmp_path / "s",
        {"a.py": method_class("C", ["f", "g"], 5) + method_class("D", ["h"], 5)},
    )
    free = make_repository(
        tmp_path / "r", {"a.py": "".join(sized(n, 5) + "\n" for n in ("f", "g", "h"))}
    )

    for root in (split, free):
        found = find(root, min_nodes=1)

        assert len(found) == 1
        assert found[0]["summary"].startswith("3 functions share one structure: ")


def test_a_pair_of_methods_keeps_the_pair_summary(tmp_path):
    root = make_repository(tmp_path, {"a.py": method_class("C", ["f", "g"], 6)})

    found = find(root, min_nodes=1)

    assert len(found) == 1
    assert "% similar to" in found[0]["summary"]


def test_findings_come_out_largest_summed_lines_first(tmp_path):
    files = {
        "a.py": sized("f", 6),
        "b.py": sized("g", 6),
        "c.py": distinct("p", 9),
        "d.py": distinct("q", 9),
        "e.py": distinct("r", 9),
    }
    root = make_repository(tmp_path, files)

    found = find(root, min_nodes=1)
    totals = [
        sum(m["lines"][1] - m["lines"][0] + 1 for m in f["evidence"]["members"]) for f in found
    ]

    assert totals == sorted(totals, reverse=True)
    assert len(found) == 2
    assert len(found[0]["evidence"]["members"]) == 3


def test_the_sample_repository_findings_are_in_non_increasing_lines_order(sample):
    found = find(sample)
    totals = [
        sum(m["lines"][1] - m["lines"][0] + 1 for m in f["evidence"]["members"]) for f in found
    ]

    assert totals == sorted(totals, reverse=True)
    assert len(found) == 2
