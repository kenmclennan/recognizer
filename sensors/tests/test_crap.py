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
    ]


@pytest.fixture
def sample(tmp_path) -> Path:
    root = tmp_path / "sample"
    shutil.copytree(FIXTURE, root)
    write_scans(root)

    return root


def with_coverage(extra):
    args = list(extra)

    if "--settings" in args:
        at = args.index("--settings") + 1
        args[at] = json.dumps({"coverage": COVERAGE, **json.loads(args[at])})
    else:
        args += ["--settings", json.dumps({"coverage": COVERAGE})]

    return args


def run_crap(root, output, *extra):
    return main(
        [
            "crap",
            "--repository",
            str(root),
            "--commit",
            "c1",
            "--output",
            str(output),
            *with_coverage(extra),
        ]
    )


def produced(root, tmp_path, *extra):
    output = tmp_path / "findings.json"
    status = run_crap(root, output, *extra)
    overlay_path = root / ".recognizer" / "cache" / "overlays" / "crap.json"

    return status, json.loads(output.read_text()), json.loads(overlay_path.read_text())


def test_the_fixture_gives_the_pinned_findings_and_overlay(sample, tmp_path, capsys):
    git_commit(sample)
    status, document, overlay = produced(sample, tmp_path)

    assert status == 0
    assert capsys.readouterr().err == ""
    Draft202012Validator(json.loads(FINDINGS_SCHEMA.read_text())).validate(document)
    Draft202012Validator(json.loads(OVERLAY_SCHEMA.read_text())).validate(overlay)
    assert document["settings"] == {
        "threshold": 30.0,
        "coverage": "coverage/lcov.info",
        "overlay": ".recognizer/cache/overlays/crap.json",
    }
    assert [f["id"] for f in document["findings"]] == [
        "crap:app/risk.py::classify",
        "crap:app/risk.py::gate",
    ]

    classify, gate = document["findings"]

    assert classify["summary"] == (
        "classify in app/risk.py has complexity 8 and 18% coverage, CRAP 43.1"
    )
    assert classify["evidence"]["measures"] == {"complexity": 8, "coverage": 0.1818, "crap": 43.053}
    assert classify["evidence"]["members"] == [
        {"module": "app/risk.py", "name": "classify", "file": "app/risk.py", "lines": [1, 11]}
    ]
    assert gate["summary"] == "gate in app/risk.py has complexity 5 and 0% coverage, CRAP 30.0"
    assert gate["evidence"]["measures"] == {"complexity": 5, "coverage": 0.0, "crap": 30.0}
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


def test_cc_five_at_zero_coverage_reports_at_exactly_the_threshold(tmp_path):
    root = python_repository(tmp_path, branches(4), lcov_for("app/m.py", range(1, 10)))

    _, document, _ = produced(root, tmp_path)
    _, higher, _ = produced(root, tmp_path, "--settings", '{"threshold":30.001}')

    assert [f["id"] for f in document["findings"]] == ["crap:app/m.py::f"]
    assert document["findings"][0]["evidence"]["measures"]["crap"] == 30.0
    assert higher["findings"] == []


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
def test_an_unreadable_coverage_file_is_one_sentence_and_exit_two(tmp_path, capsys, kind):
    root = python_repository(tmp_path, branches(1))
    target = root / "coverage" / "lcov.info"
    target.unlink()

    if kind == "directory":
        target.mkdir()

    output = tmp_path / "findings.json"

    assert run_crap(root, output) == 2
    assert capsys.readouterr().err == f"the coverage file is missing: {COVERAGE}\n"
    assert not output.exists()
    assert not (root / ".recognizer" / "cache" / "overlays" / "crap.json").exists()


def test_a_binary_coverage_file_leaves_every_function_unknown(tmp_path, capsys):
    root = python_repository(tmp_path, branches(1))
    (root / "coverage" / "lcov.info").write_bytes(b"\xff\xfe\x00")

    status, _, overlay = produced(root, tmp_path)

    assert status == 0
    assert capsys.readouterr().err == ""
    assert overlay["values"]["complexity"] == {"app/m.py::f": 2}
    assert overlay["values"]["coverage"] == {}


def test_the_coverage_setting_may_name_no_file(tmp_path, capsys):
    root = python_repository(tmp_path, branches(1))

    status = run_crap(root, tmp_path / "o.json", "--settings", '{"coverage":"nothing/here.info"}')

    assert status == 2
    assert capsys.readouterr().err == "the coverage file is missing: nothing/here.info\n"


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

    assert changed == {".recognizer/cache/overlays/crap.json"}
    assert (tmp_path / "out.json").exists()


def test_the_overlay_path_setting_is_honoured_and_parents_are_created(sample, tmp_path):
    run_crap(sample, tmp_path / "out.json", "--settings", '{"overlay":"deep/er/o.json"}')

    assert (sample / "deep" / "er" / "o.json").exists()
    assert not (sample / ".recognizer" / "cache" / "overlays").exists()


def test_two_runs_give_the_same_bytes(sample, tmp_path):
    def run(name):
        output = tmp_path / name
        run_crap(sample, output)

        return output.read_bytes(), (sample / ".recognizer/cache/overlays/crap.json").read_bytes()

    assert run("a.json") == run("b.json")


def test_two_runs_give_the_same_bytes_under_another_hash_seed(sample, tmp_path):
    def run(seed, name):
        subprocess.run(
            [sys.executable, "-m", "recognizer_sensors", "crap", "--repository", str(sample)]
            + ["--commit", "c1", "--output", str(tmp_path / name)]
            + ["--settings", json.dumps({"coverage": COVERAGE})],
            check=True,
            env={"PYTHONHASHSEED": seed, "PATH": ""},
        )

        return (tmp_path / name).read_bytes(), (
            sample / ".recognizer/cache/overlays/crap.json"
        ).read_bytes()

    assert run("1", "a.json") == run("2", "b.json")


def test_a_failing_findings_write_exits_non_zero(sample, tmp_path):
    with pytest.raises(OSError):
        run_crap(sample, tmp_path / "missing-folder" / "out.json")


def test_duplication_writes_only_its_output(tmp_path):
    root = tmp_path / "dup"
    shutil.copytree(REPOSITORY / "fixtures" / "duplication" / "sample", root)
    write_scans(root)
    before = tree_state(root)

    main(
        [
            "duplication",
            "--repository",
            str(root),
            "--commit",
            "c1",
            "--output",
            str(tmp_path / "o"),
        ]
    )

    assert tree_state(root) == before


def test_a_committed_repository_keeps_the_commit(sample, tmp_path):
    sha = git_commit(sample)

    main(
        ["crap", "--repository", str(sample), "--output", str(tmp_path / "o.json")]
        + with_coverage([])
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
