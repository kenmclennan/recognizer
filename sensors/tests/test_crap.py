import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import REPOSITORY, git_commit, make_repository, write_scans
from jsonschema import Draft202012Validator

from recognizer_sensors import hashes
from recognizer_sensors.cli import main
from recognizer_sensors.crap.complexity import cyclomatic_complexity
from recognizer_sensors.crap.lcov import function_coverage, parse_lcov, read_lcov
from recognizer_sensors.crap.sensor import parse_settings
from recognizer_sensors.functions import find_functions
from recognizer_sensors.identity import assign_identities
from recognizer_sensors.parsing import parse
from recognizer_sensors.scans import read_scans
from recognizer_sensors.settings import SettingsError

FIXTURE = REPOSITORY / "fixtures" / "crap" / "sample"
FINDINGS_SCHEMA = REPOSITORY / "schema" / "findings.schema.json"
OVERLAY_SCHEMA = REPOSITORY / "schema" / "overlay.schema.json"
COVERAGE = "coverage/lcov.info"

PYTHON = """def f(a, b, xs, v):
    if a and b or not a:
        pass
    elif b:
        pass
    for x in xs:
        pass
    while a:
        pass
    try:
        pass
    except ValueError:
        pass
    y = 1 if a else 2
    z = [i for i in xs if i]
    match v:
        case 1:
            pass
        case _:
            pass
"""
TYPESCRIPT = """function f(a: any, b: any, c: any, xs: any[], o: any) {
  if (a && b || c) {
  } else if (b) {
  }
  for (let i = 0; i < 1; i++) {}
  for (const k in o) {}
  for (const x of xs) {}
  while (a) {}
  do {} while (a);
  switch (a) {
    case 1:
      break;
    case 2:
      break;
    default:
      break;
  }
  try {} catch (e) {}
  const t = a ? 1 : 2;
  const n = a ?? b;
  const p = o?.b?.c;
}
"""
KOTLIN = """fun f(a: Boolean, b: Boolean, xs: List<Int>, v: Int): Int {
    if (a && b) {
        println(1)
    } else if (a || b) {
        println(2)
    }
    for (x in xs) {
        println(x)
    }
    while (a) {
        println(3)
    }
    do {
        println(4)
    } while (b)
    when (v) {
        1 -> println(5)
        2 -> println(6)
        else -> println(7)
    }
    try {
        println(8)
    } catch (e: Exception) {
        println(9)
    }
    return 0
}
"""
RUST = """fn f(a: bool, b: bool, xs: Vec<i32>, v: Option<i32>, w: i32) -> i32 {
    if a && b {
        println!("1");
    } else if a || b {
        println!("2");
    }
    for x in xs {
        println!("{}", x);
    }
    while a {
        println!("3");
    }
    if let Some(y) = v {
        println!("{}", y);
    }
    match w {
        1 => println!("a"),
        2 => println!("b"),
        _ => println!("c"),
    }
    let g = |z: i32| { if z > 0 { 1 } else { 2 } };
    g(1)
}
"""


def complexities(grammar, source):
    root = parse(grammar, source.encode()).root_node
    found = find_functions(root, grammar)
    ids = {f.node.id for f in found}

    return {
        f.qualified: cyclomatic_complexity(f.node, grammar, ids - {f.node.id})
        for f in found
        if not f.node.has_error
    }


def test_the_worked_examples_pin_the_complexity():
    assert complexities("python", PYTHON) == {"f": 13}
    assert complexities("typescript", TYPESCRIPT) == {"f": 17}
    assert complexities("kotlin", KOTLIN) == {"f": 12}
    assert complexities("rust", RUST) == {"f": 12}


@pytest.mark.parametrize(
    ("grammar", "source", "expected"),
    [
        ("python", "def f(a):\n    if a:\n        pass\n", 2),
        ("python", "def f(a):\n    if a:\n        pass\n    elif a:\n        pass\n", 3),
        ("python", "def f(a):\n    for x in a:\n        pass\n", 2),
        ("python", "def f(a):\n    while a:\n        pass\n", 2),
        ("python", "def f(a):\n    try:\n        pass\n    except E:\n        pass\n", 2),
        ("python", "def f(a):\n    return 1 if a else 2\n", 2),
        ("python", "def f(a):\n    return [x for x in a if x]\n", 3),
        ("python", "def f(a, b):\n    return a and b\n", 2),
        ("python", "def f(a, b):\n    return a or b\n", 2),
        ("python", "def f(a):\n    match a:\n        case 1:\n            pass\n", 2),
        ("typescript", "function f(a: any) {\n  if (a) {}\n}\n", 2),
        ("typescript", "function f(a: any) {\n  for (;;) {}\n}\n", 2),
        ("typescript", "function f(a: any) {\n  for (const k in a) {}\n}\n", 2),
        ("typescript", "function f(a: any) {\n  while (a) {}\n}\n", 2),
        ("typescript", "function f(a: any) {\n  do {} while (a);\n}\n", 2),
        (
            "typescript",
            "function f(a: any) {\n  switch (a) {\n    case 1:\n      break;\n  }\n}\n",
            2,
        ),
        ("typescript", "function f() {\n  try {} catch (e) {}\n}\n", 2),
        ("typescript", "function f(a: any) {\n  return a ? 1 : 2;\n}\n", 2),
        ("typescript", "function f(a: any) {\n  return a?.b;\n}\n", 2),
        ("typescript", "function f(a: any) {\n  return a?.b?.c;\n}\n", 3),
        ("typescript", "function f(a: any, b: any) {\n  return a ?? b;\n}\n", 2),
        ("typescript", "function f(a: any, b: any) {\n  return a && b;\n}\n", 2),
        (
            "kotlin",
            "fun f(a: Boolean): Int {\n    if (a) {\n        return 1\n    }\n    return 2\n}\n",
            2,
        ),
        (
            "kotlin",
            "fun f(xs: List<Int>): Int {\n    for (x in xs) {\n        println(x)\n    }\n    return 0\n}\n",
            2,
        ),
        (
            "kotlin",
            "fun f(a: Boolean): Int {\n    while (a) {\n        println(1)\n    }\n    return 0\n}\n",
            2,
        ),
        (
            "kotlin",
            "fun f(a: Boolean): Int {\n    do {\n        println(1)\n    } while (a)\n    return 0\n}\n",
            2,
        ),
        (
            "kotlin",
            "fun f(v: Int): Int {\n    when (v) {\n        1 -> println(1)\n        else -> println(2)\n    }\n    return 0\n}\n",
            3,
        ),
        (
            "kotlin",
            "fun f(): Int {\n    try {\n        println(1)\n    } catch (e: Exception) {\n        println(2)\n    }\n    return 0\n}\n",
            2,
        ),
        ("kotlin", "fun f(a: Boolean, b: Boolean): Boolean {\n    return a && b\n}\n", 2),
        ("kotlin", "fun f(a: Boolean, b: Boolean): Boolean {\n    return a || b\n}\n", 2),
        (
            "kotlin",
            "fun f(a: Boolean, b: Boolean, c: Boolean): Boolean {\n    return a && b || c\n}\n",
            3,
        ),
        ("rust", 'fn f(a: bool) {\n    if a {\n        println!("x");\n    }\n}\n', 2),
        (
            "rust",
            'fn f(a: Vec<i32>) {\n    for x in a {\n        println!("{}", x);\n    }\n}\n',
            2,
        ),
        ("rust", 'fn f(a: bool) {\n    while a {\n        println!("x");\n    }\n}\n', 2),
        (
            "rust",
            'fn f(a: i32) {\n    match a {\n        1 => println!("x"),\n        _ => println!("y"),\n    }\n}\n',
            3,
        ),
        ("rust", "fn f(a: bool, b: bool) -> bool {\n    a || b\n}\n", 2),
    ],
)
def test_each_branch_point_adds_one(grammar, source, expected):
    assert complexities(grammar, source) == {"f": expected}


@pytest.mark.parametrize(
    ("grammar", "source"),
    [
        ("python", "def f(a):\n    try:\n        pass\n    finally:\n        pass\n"),
        ("typescript", "function f(a: any) {\n  let b = 1;\n  b ||= a;\n  b ??= a;\n}\n"),
        (
            "typescript",
            "function f(a: any) {\n  try {} finally {}\n  switch (a) {\n    default:\n      break;\n  }\n}\n",
        ),
        ("kotlin", "fun f(a: Int?): Int {\n    val b = a ?: 0\n    return b\n}\n"),
        ("kotlin", "fun f(a: String?): Int {\n    val b = a?.length\n    return 0\n}\n"),
        ("rust", "fn f() {\n    loop {\n        break;\n    }\n}\n"),
        ("rust", "fn f(a: Option<i32>) -> Option<i32> {\n    let b = a?;\n    Some(b)\n}\n"),
    ],
)
def test_constructs_that_add_nothing(grammar, source):
    assert complexities(grammar, source) == {"f": 1}


def test_an_else_if_counts_once_and_else_nothing():
    source = (
        "def f(a):\n    if a:\n        pass\n    elif a:\n        pass\n    else:\n        pass\n"
    )

    assert complexities("python", source) == {"f": 3}


def test_a_nested_unit_function_is_counted_on_its_own():
    source = (
        "def outer(a):\n    if a:\n        pass\n\n    def inner(b):\n        if b:\n"
        "            pass\n        if b:\n            pass\n\n    return inner\n"
    )

    assert complexities("python", source) == {"outer": 2, "outer.inner": 3}


def test_an_anonymous_callback_counts_in_the_enclosing_function():
    source = (
        "function outer(xs: any[]) {\n  return xs.map((x) => {\n    if (x) {\n      return 1;\n"
        "    }\n    return 2;\n  });\n}\n"
    )

    assert complexities("typescript", source) == {"outer": 2}


def test_a_function_with_a_syntax_error_is_skipped():
    assert complexities("python", "def f(a:\n    if a\n") == {}


def test_identities_add_the_start_line_for_a_repeated_name():
    assert assign_identities([("m", "f", 1), ("m", "f", 9), ("m", "g", 5), ("n", "f", 1)]) == [
        "m::f@1",
        "m::f@9",
        "m::g",
        "n::f",
    ]


LCOV = """TN:
SF:a.py
FN:1,f
FNDA:1,f
DA:1,2
DA:2,0
BRDA:1,0,0,1
LF:2
LH:1
end_of_record
SF:./b.py
DA:1,1
DA:x,1
DA:3,-1
DA:4,1,abc
end_of_record
SF:a.py
DA:2,3
end_of_record
SF:{root}/c.py
DA:5,1
end_of_record
SF:/elsewhere/d.py
DA:1,1
end_of_record
SF:e.py
DA:1,1
"""


def test_lcov_merges_normalises_and_ignores(tmp_path):
    coverage = parse_lcov(LCOV.replace("{root}", str(tmp_path.resolve())), tmp_path)

    assert coverage["a.py"] == {1: 2, 2: 3}
    assert coverage["b.py"] == {1: 1, 4: 1}
    assert coverage["c.py"] == {5: 1}
    assert coverage["e.py"] == {1: 1}
    assert "/elsewhere/d.py" not in coverage and "d.py" not in coverage


def test_function_coverage_counts_instrumented_lines_in_range():
    lines = {1: 1, 2: 0, 3: 4, 9: 0}

    assert function_coverage(lines, 1, 3) == pytest.approx(2 / 3)
    assert function_coverage(lines, 5, 8) is None
    assert function_coverage(None, 1, 3) is None


def test_read_lcov_is_none_for_missing_directory_and_binary(tmp_path):
    binary = tmp_path / "bin.info"
    binary.write_bytes(b"\xff\xfe\x00")

    assert read_lcov(tmp_path / "none.info", tmp_path) is None
    assert read_lcov(tmp_path, tmp_path) is None
    assert read_lcov(binary, tmp_path) is None


@pytest.mark.parametrize(
    "raw",
    [
        {"threshold": 0},
        {"threshold": -1},
        {"threshold": "30"},
        {"threshold": True},
        {"coverage": "/abs/lcov.info"},
        {"coverage": "../lcov.info"},
        {"coverage": ""},
        {"coverage": 3},
        {"overlay": "/abs/o.json"},
        {"overlay": "a/../../o.json"},
        {"overlay": ""},
        {"overlay": None},
        {"nope": 1},
    ],
)
def test_bad_settings_are_refused(raw):
    with pytest.raises(SettingsError):
        parse_settings(raw)


def test_bad_settings_exit_two(sample, tmp_path):
    assert run_crap(sample, tmp_path / "o.json", "--settings", '{"threshold":0}') == 2


def test_defaults_are_recorded_in_order():
    assert list(parse_settings({}).items()) == [
        ("threshold", 30.0),
        ("overlay", ".recognizer/cache/overlays/crap.json"),
        ("suites", None),
    ]


@pytest.fixture
def sample(tmp_path) -> Path:
    root = tmp_path / "sample"
    shutil.copytree(FIXTURE, root)
    write_scans(root)

    return root


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")


def scanned_languages(root):
    return sorted(
        p.name.split(".")[1] for p in (root / ".recognizer" / "cache").glob("scan.*.json")
    )


def suites_for(root, coverage=COVERAGE, command=None):
    return [
        {
            "name": language,
            "language": language,
            "directory": ".",
            "command": command or f"touch {coverage}",
            "coverage": {"path": coverage, "format": "lcov"},
            **({"runner": "vitest"} if language == "typescript" else {}),
        }
        for language in scanned_languages(root)
    ]


def with_suites(root, extra, coverage=COVERAGE, command=None):
    args = list(extra)
    tests = {"tests": suites_for(root, coverage, command)}

    if "--settings" in args:
        at = args.index("--settings") + 1
        args[at] = json.dumps({**tests, **json.loads(args[at])})
    else:
        args += ["--settings", json.dumps(tests)]

    return args


def run_crap(root, output, *extra, coverage=COVERAGE, command=None):
    return main(
        [
            "crap",
            "--repository",
            str(root),
            "--commit",
            "c1",
            "--output",
            str(output),
            *with_suites(root, extra, coverage, command),
        ]
    )


def produced(root, tmp_path, *extra, **named):
    output = tmp_path / "findings.json"
    status = run_crap(root, output, *extra, **named)
    overlay_path = root / ".recognizer" / "cache" / "overlays" / "crap.json"

    return status, json.loads(output.read_text()), json.loads(overlay_path.read_text())


def test_the_fixture_gives_the_pinned_findings_and_overlay(sample, tmp_path, capsys):
    git_commit(sample)
    status, document, overlay = produced(sample, tmp_path)

    assert status == 0
    assert capsys.readouterr().err == ""
    Draft202012Validator(json.loads(FINDINGS_SCHEMA.read_text())).validate(document)
    Draft202012Validator(json.loads(OVERLAY_SCHEMA.read_text())).validate(overlay)
    assert list(document["settings"]) == ["threshold", "overlay", "suites"]
    assert document["settings"]["threshold"] == 30.0
    assert document["settings"]["overlay"] == ".recognizer/cache/overlays/crap.json"
    assert [suite["name"] for suite in document["settings"]["suites"]] == ["python", "typescript"]
    assert [f["id"] for f in document["findings"]] == ["crap:app/risk.py::classify"]

    [classify] = document["findings"]

    assert classify["summary"] == (
        "classify in app/risk.py has complexity 8 and 18% coverage, CRAP 43.1"
    )
    assert classify["evidence"]["measures"] == {"complexity": 8, "coverage": 0.1818, "crap": 43.053}
    assert classify["evidence"]["members"] == [
        {"module": "app/risk.py", "name": "classify", "file": "app/risk.py", "lines": [1, 11]}
    ]
    assert overlay["commit"] == "c1"
    assert overlay["modified"] is False
    assert overlay["producer"]["name"] == "crap"
    assert [m["name"] for m in overlay["metrics"]] == ["complexity", "coverage", "crap"]
    assert overlay["values"]["complexity"] == {
        "app/risk.py::classify": 8,
        "app/risk.py::gate": 5,
        "app/risk.py::label": 2,
        "app/risk.py::tidy": 2,
        "src/other.ts::pick": 1,
        "src/rules.ts::route": 8,
        "src/rules.ts::shout": 2,
    }
    assert overlay["values"]["coverage"]["app/risk.py::classify"] == 0.1818
    assert overlay["values"]["coverage"]["app/risk.py::tidy"] == 0.75
    assert overlay["values"]["coverage"]["src/rules.ts::route"] == 1.0
    assert overlay["values"]["crap"]["app/risk.py::gate"] == 30.0
    assert overlay["values"]["crap"]["src/rules.ts::route"] == 8.0
    assert len(overlay["values"]["complexity"]) == 7
    assert len(overlay["values"]["coverage"]) == 6
    assert len(overlay["values"]["crap"]) == 6
    assert "src/other.ts::pick" not in overlay["values"]["coverage"]
    assert "src/other.ts::pick" not in overlay["values"]["crap"]


def python_repository(tmp_path, body, lcov=None):
    root = make_repository(tmp_path / "r", {"app/m.py": body})

    (root / "coverage").mkdir()
    (root / "coverage" / "lcov.info").write_text(
        lcov if lcov is not None else lcov_for("other.py", [1])
    )

    return root


def branches(count):
    lines = ["def f(a):"]
    lines += ["    if a:\n        pass"] * count
    return "\n".join(lines) + "\n"


def lcov_for(path, lines, hits=0):
    return f"SF:{path}\n" + "".join(f"DA:{n},{hits}\n" for n in lines) + "end_of_record\n"


def test_a_score_of_exactly_the_threshold_does_not_report(tmp_path):
    root = python_repository(tmp_path, branches(4), lcov_for("app/m.py", range(1, 10)))

    _, document, overlay = produced(root, tmp_path)
    _, lower, _ = produced(root, tmp_path, "--settings", '{"threshold":29.999}')

    assert overlay["values"]["crap"] == {"app/m.py::f": 30.0}
    assert document["findings"] == []
    assert [f["id"] for f in lower["findings"]] == ["crap:app/m.py::f"]
    assert lower["findings"][0]["evidence"]["measures"]["crap"] == 30.0


def test_a_score_above_the_threshold_reports(tmp_path):
    root = python_repository(tmp_path, branches(5), lcov_for("app/m.py", range(1, 12)))

    _, document, _ = produced(root, tmp_path)

    assert [f["id"] for f in document["findings"]] == ["crap:app/m.py::f"]
    assert document["findings"][0]["evidence"]["measures"]["crap"] == 42.0


def test_a_finding_at_the_published_threshold_cites_its_source(tmp_path):
    root = python_repository(tmp_path, branches(5), lcov_for("app/m.py", range(1, 12)))

    _, document, _ = produced(root, tmp_path)

    assert len(document["findings"]) == 1
    assert document["findings"][0]["principle"] == "change-risk-anti-patterns"
    assert (
        document["findings"][0]["citation"]
        == json.loads((REPOSITORY / "fixtures" / "sensors" / "principles.json").read_text())[0][
            "citation"
        ]
    )


def test_a_finding_at_another_threshold_cites_its_source_and_names_both(tmp_path):
    root = python_repository(tmp_path, branches(4), lcov_for("app/m.py", range(1, 10)))

    _, document, _ = produced(root, tmp_path, "--settings", '{"threshold":25}')
    finding = document["findings"][0]

    assert len(document["findings"]) == 1
    assert finding["principle"] == "change-risk-anti-patterns"
    assert finding["citation"]["author"] == "Alberto Savoia and Bob Evans"
    assert finding["evidence"]["measures"]["limit"] == 25
    assert finding["evidence"]["measures"]["published"] == 30
    assert "threshold of 25" in finding["summary"]
    assert "Savoia and Evans say 30" in finding["summary"]


def test_a_finding_at_the_published_threshold_carries_no_published_figure(tmp_path):
    root = python_repository(tmp_path, branches(30), lcov_for("app/m.py", range(1, 40)))

    _, document, _ = produced(root, tmp_path, "--settings", '{"threshold":30}')
    finding = document["findings"][0]

    assert finding["principle"] == "change-risk-anti-patterns"
    assert "published" not in finding["evidence"]["measures"]
    assert "limit" not in finding["evidence"]["measures"]
    assert "threshold of" not in finding["summary"]


def test_cc_four_at_zero_coverage_does_not_report(tmp_path):
    root = python_repository(tmp_path, branches(3), lcov_for("app/m.py", range(1, 8)))

    _, document, _ = produced(root, tmp_path)

    assert document["findings"] == []


def test_a_high_complexity_function_with_unknown_coverage_reports_a_floor(tmp_path, capsys):
    root = python_repository(tmp_path, branches(30))

    _, document, overlay = produced(root, tmp_path)

    assert document["findings"][0]["summary"] == (
        "f in app/m.py has complexity 31 and unknown coverage, CRAP at least 31"
    )
    assert document["findings"][0]["evidence"]["measures"] == {"complexity": 31}
    assert overlay["values"]["coverage"] == {}
    assert overlay["values"]["crap"] == {}
    assert capsys.readouterr().err == ""


def test_unknown_coverage_at_exactly_the_threshold_has_no_finding(tmp_path):
    root = python_repository(tmp_path, branches(29))

    _, document, overlay = produced(root, tmp_path)

    assert overlay["values"]["complexity"] == {"app/m.py::f": 30}
    assert document["findings"] == []


def test_a_lower_complexity_function_with_unknown_coverage_has_no_finding(tmp_path):
    root = python_repository(tmp_path, branches(5))

    _, document, overlay = produced(root, tmp_path)

    assert document["findings"] == []
    assert overlay["values"] == {"complexity": {"app/m.py::f": 6}, "coverage": {}, "crap": {}}


def test_a_file_with_a_record_but_no_line_in_range_is_unknown(tmp_path):
    root = python_repository(tmp_path, branches(1), lcov_for("app/m.py", [50]))

    _, _, overlay = produced(root, tmp_path)

    assert overlay["values"]["coverage"] == {}


@pytest.mark.parametrize("kind", ["missing", "directory"])
def test_a_suite_report_that_does_not_exist_is_coverage_unavailable(tmp_path, capsys, kind):
    root = python_repository(tmp_path, branches(1))
    target = root / "coverage" / "lcov.info"
    target.unlink()

    if kind == "directory":
        target.mkdir()

    status, document, overlay = produced(root, tmp_path, command="true")

    assert status == 0
    assert capsys.readouterr().err == ""
    assert document["diagnosis"]["code"] == "coverage-unavailable"
    assert document["diagnosis"]["line"] == (
        "coverage unavailable: the python suite left no coverage report at "
        "coverage/lcov.info; see .recognizer/cache/coverage/last-run.log"
    )
    assert overlay["values"]["coverage"] == {}


def test_a_binary_coverage_file_leaves_every_function_unknown(tmp_path, capsys):
    root = python_repository(tmp_path, branches(1))
    (root / "coverage" / "lcov.info").write_bytes(b"\xff\xfe\x00")

    status, _, overlay = produced(root, tmp_path)

    assert status == 0
    assert capsys.readouterr().err == ""
    assert overlay["values"]["complexity"] == {"app/m.py::f": 2}
    assert overlay["values"]["coverage"] == {}


def test_an_empty_coverage_file_is_not_an_error(tmp_path, capsys):
    root = python_repository(tmp_path, branches(1), "")

    status, _, overlay = produced(root, tmp_path)

    assert status == 0
    assert capsys.readouterr().err == ""
    assert overlay["values"]["coverage"] == {}


def test_a_fixture_with_an_empty_report_has_only_complexity(tmp_path, capsys):
    root = tmp_path / "dup"
    shutil.copytree(REPOSITORY / "fixtures" / "duplication" / "sample", root)
    write_scans(root)
    (root / "coverage").mkdir()
    (root / "coverage" / "lcov.info").write_text("")

    status, document, overlay = produced(root, tmp_path)

    assert status == 0
    assert document["findings"] == []
    assert capsys.readouterr().err == ""
    assert len(overlay["values"]["complexity"]) == 6
    assert overlay["values"]["coverage"] == {}
    assert overlay["values"]["crap"] == {}


def tree_state(root):
    return {
        str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()
    }


def test_only_the_findings_and_the_overlay_are_written(sample, tmp_path):
    before = tree_state(sample)

    run_crap(sample, tmp_path / "out.json")

    after = tree_state(sample)
    changed = {k for k in after if before.get(k) != after[k]}

    assert changed == {
        ".recognizer/cache/overlays/crap.json",
        ".recognizer/cache/coverage/last-run.log",
        ".recognizer/cache/suites/crap.json",
    }
    assert (tmp_path / "out.json").exists()


def test_the_overlay_path_setting_is_honoured_and_parents_are_created(sample, tmp_path):
    run_crap(sample, tmp_path / "out.json", "--settings", '{"overlay":"deep/er/o.json"}')

    assert (sample / "deep" / "er" / "o.json").exists()
    assert not (sample / ".recognizer" / "cache" / "overlays").exists()


def test_two_runs_give_the_same_bytes(sample, tmp_path):
    def run(name):
        output = tmp_path / name
        run_crap(sample, output)

        document = json.loads(output.read_text())

        for entry in document["suites"]:
            entry["ran_at"] = None

        return document, (sample / ".recognizer/cache/overlays/crap.json").read_bytes()

    assert run("a.json") == run("b.json")


def test_two_runs_give_the_same_bytes_under_another_hash_seed(sample, tmp_path):
    def run(seed, name):
        subprocess.run(
            [sys.executable, "-m", "recognizer_sensors", "crap", "--repository", str(sample)]
            + ["--commit", "c1", "--output", str(tmp_path / name)]
            + ["--settings", json.dumps({"tests": suites_for(sample)})],
            check=True,
            env={"PYTHONHASHSEED": seed, "PATH": "/usr/bin:/bin", "SHELL": "/bin/sh"},
        )

        document = json.loads((tmp_path / name).read_text())

        for entry in document["suites"]:
            entry["ran_at"] = None

        return document, (sample / ".recognizer/cache/overlays/crap.json").read_bytes()

    assert run("1", "a.json") == run("2", "b.json")


def test_a_failing_findings_write_exits_non_zero(sample, tmp_path):
    with pytest.raises(OSError):
        run_crap(sample, tmp_path / "missing-folder" / "out.json")


def test_a_committed_repository_keeps_the_commit(sample, tmp_path):
    sha = git_commit(sample)

    main(
        ["crap", "--repository", str(sample), "--output", str(tmp_path / "o.json")]
        + with_suites(sample, [])
    )

    assert json.loads((tmp_path / "o.json").read_text())["commit"] == sha


def test_crap_writes_version_two_with_inputs_from_the_scan_and_the_tests_hash(sample, tmp_path):
    status, document, overlay = produced(sample, tmp_path)

    assert status == 0
    assert document["findings_version"] == 2
    assert overlay["overlay_version"] == 2
    assert overlay["inputs"] == document["inputs"]
    assert overlay["inputs"] != {}
    assert set(overlay["inputs"].values()) == {"0" * 64}
    assert overlay["tests"] == document["tests"] == hashes.tests_hash(sample, [])


def test_a_crap_run_with_no_tests_list_exits_two_and_leaves_a_prior_overlay(
    sample, tmp_path, capsys
):
    overlay_path = sample / ".recognizer" / "cache" / "overlays" / "crap.json"
    overlay_path.parent.mkdir(parents=True)
    overlay_path.write_text("prior")
    output = tmp_path / "findings.json"

    status = main(["crap", "--repository", str(sample), "--commit", "c1", "--output", str(output)])

    assert status == 2
    assert capsys.readouterr().err.splitlines()[-1] == (
        "coverage unavailable: no test suites are configured; "
        "add a tests list to .recognizer/config.yaml"
    )
    assert not output.exists()
    assert overlay_path.read_text() == "prior"
    assert not (sample / ".recognizer" / "cache" / "coverage").exists()


PART_BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"


def lcov_command(source, hits):
    lines = "".join(f"DA:{n},{h}\\n" for n, h in hits)

    return f"mkdir -p out && printf 'SF:{source}\\n{lines}end_of_record\\n' > out/lcov.info"


def two_suite_repository(tmp_path, web_hits=((1, 1), (2, 1), (3, 1))):
    root = make_repository(
        tmp_path / "two",
        {
            "unit/a.py": PART_BODY,
            "unit/test_a.py": "def test_a():\n    assert True\n",
            "web/b.py": PART_BODY,
            "web/test_b.py": "def test_b():\n    assert True\n",
        },
    )
    git_commit(root)
    rehash(root)

    return root


def rehash(root, only=None):
    path = root / ".recognizer/cache/scan.python.json"
    scan = json.loads(path.read_text())

    for entry in scan["files"]:
        entry["hash"] = hashes.file_sha256(root / entry["path"])

    path.write_text(json.dumps(scan))


def two_suite_settings(web_hits=((1, 1), (2, 1), (3, 1)), unit_hits=((1, 1), (2, 1), (3, 0))):
    suites = [
        {
            "name": "unit",
            "language": "python",
            "directory": "unit",
            "command": lcov_command("a.py", unit_hits),
            "coverage": {"path": "out/lcov.info", "format": "lcov"},
        },
        {
            "name": "web",
            "language": "python",
            "directory": "web",
            "command": lcov_command("b.py", web_hits),
            "coverage": {"path": "out/lcov.info", "format": "lcov"},
        },
    ]

    return json.dumps({"tests": suites})


def crap_suites(root, tmp_path, settings, *extra):
    output = tmp_path / "findings.json"
    status = main(
        [
            "crap",
            "--repository",
            str(root),
            "--commit",
            "c1",
            "--output",
            str(output),
            "--settings",
            settings,
            *extra,
        ]
    )
    overlay = json.loads((root / ".recognizer/cache/overlays/crap.json").read_text())

    return status, json.loads(output.read_text()), overlay


def test_a_run_of_one_suite_keeps_the_other_suites_coverage_and_age(tmp_path):
    root = two_suite_repository(tmp_path)

    status, first, first_overlay = crap_suites(root, tmp_path, two_suite_settings())

    assert status == 0
    assert [s["name"] for s in first["suites"]] == ["unit", "web"]
    assert first["tests"] == hashes.tests_hash(root, read_scans(root))

    web_ran_at = first["suites"][1]["ran_at"]
    settings = two_suite_settings(unit_hits=((1, 0), (2, 0), (3, 0)))

    status, second, overlay = crap_suites(root, tmp_path, settings, "--suites", '["unit"]')

    assert status == 0
    assert second["suites"][1] == {"name": "web", "status": "ok", "ran_at": web_ran_at}
    assert second["suites"][0]["status"] == "ok"
    assert overlay["values"]["coverage"].keys() == first_overlay["values"]["coverage"].keys()

    web_identity = next(k for k in overlay["values"]["coverage"] if "web/b.py" in k)

    assert (
        overlay["values"]["coverage"][web_identity]
        == first_overlay["values"]["coverage"][web_identity]
    )
    assert second["tests"] == hashes.tests_hash(root, read_scans(root))

    (root / "web" / "test_b.py").write_text("def test_b():\n    assert 1 == 1\n")
    rehash(root)

    status, third, _ = crap_suites(root, tmp_path, settings, "--suites", '["unit"]')

    assert status == 0
    assert third["tests"] != hashes.tests_hash(root, read_scans(root))


def test_a_suite_that_never_ran_is_never_and_its_files_hash_to_zeros(tmp_path):
    root = two_suite_repository(tmp_path)

    status, document, _ = crap_suites(root, tmp_path, two_suite_settings(), "--suites", '["unit"]')

    assert status == 0
    assert document["suites"][1] == {"name": "web", "status": "never", "ran_at": None}
    assert document["tests"] != hashes.tests_hash(root, read_scans(root))

    current = hashes.test_map(root, read_scans(root))
    zeros = {**current, "web/test_b.py": "0" * 64}

    assert document["tests"] == hashes.digest_of(zeros)


def test_a_source_change_under_an_unselected_suite_marks_its_module_out_of_date(tmp_path):
    root = two_suite_repository(tmp_path)
    _, first, _ = crap_suites(root, tmp_path, two_suite_settings())

    assert first["inputs"]["web/b.py"] == hashes.file_sha256(root / "web/b.py")

    (root / "web" / "b.py").write_text(PART_BODY + "\n\ndef extra():\n    return 3\n")
    rehash(root)

    _, second, _ = crap_suites(root, tmp_path, two_suite_settings(), "--suites", '["unit"]')

    assert second["inputs"]["web/b.py"] == first["inputs"]["web/b.py"]
    assert second["inputs"]["unit/a.py"] == first["inputs"]["unit/a.py"]

    _, third, _ = crap_suites(root, tmp_path, two_suite_settings())

    assert third["inputs"]["web/b.py"] == hashes.file_sha256(root / "web/b.py")
