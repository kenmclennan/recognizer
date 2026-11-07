import json
import os
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from conftest import git_commit, write_scan_document
from test_mutation import RECORD, read, run_mutate

from recognizer_sensors.testrun import profiles
from recognizer_sensors.testrun.profiles import (
    RUST_UNITS,
    mutant_command,
    rust_by_target_command,
    rust_selected_command,
    selected_command,
)
from recognizer_sensors.testrun.run import collect_coverage_with_tests, rust_units

LIB = "src/lib.rs"

TOOL = "src/bin/tool.rs"

ADD = "tests/add_tests.rs"

MANY = "tests/many.rs"

DIRT = "tests/dirt/main.rs"

FAKE_CARGO = """#!/bin/sh
echo "$@" >> "$FAKE_LOG"
if [ "$1" = "metadata" ]; then
  [ -n "$FAKE_METADATA_FAIL" ] && exit 101
  cat "$FAKE_METADATA"
  exit 0
fi
output=""
previous=""
target=""
for arg in "$@"; do
  [ "$previous" = "--output-path" ] && output="$arg"
  case "$previous" in --test|--bin) target="$arg" ;; esac
  previous="$arg"
done
case " $* " in *" --lib "*) target="lib" ;; esac
if [ "$1" = "test" ]; then
  if cmp -s src/lib.rs "$FAKE_PRISTINE"; then exit 0; fi
  echo "MUTANT $*" >> "$FAKE_LOG"
  exit 1
fi
[ -n "$FAKE_FAIL" ] && [ "$target" = "$FAKE_FAIL" ] && exit 101
[ -n "$FAKE_NO_REPORT" ] && [ "$target" = "$FAKE_NO_REPORT" ] && exit 0
if [ -n "$FAKE_BAD_REPORT" ] && [ "$target" = "$FAKE_BAD_REPORT" ]; then
  printf '\\377\\376' > "$output"
  exit 0
fi
if [ -n "$FAKE_COVER" ]; then
  {
    echo "SF:$PWD/src/lib.rs"
    for n in 1 2 3 5 6 7 9 10 11; do
      if [ -z "$target" ] || grep -qx "$n $target" "$FAKE_COVER"; then
        echo "DA:$n,1"
      else
        echo "DA:$n,0"
      fi
    done
    echo end_of_record
  } > "$output"
  exit 0
fi
{
  echo "SF:$PWD/src/lib.rs"
  for n in 1 5 9; do
    case "$n:$target" in
      1:add_tests|1:tool|5:many|5:dirt|9:many|9:lib|1:|5:|9:) echo "DA:$n,1" ;;
      *) echo "DA:$n,0" ;;
    esac
  done
  echo end_of_record
} > "$output"
exit 0
"""


def metadata(root, targets, **extra):
    resolved = root.resolve()
    members = [
        {
            "id": "calc 0.1.0",
            "name": "calc",
            "targets": [
                {
                    "kind": [kind],
                    "name": name,
                    "src_path": str(resolved / path),
                    "test": test,
                    **({"required-features": ["x"]} if gated else {}),
                }
                for kind, name, path, test, gated in targets
            ],
        },
        {"id": "other 0.1.0", "name": "other", "targets": []},
    ]

    return {"packages": members, "workspace_default_members": ["calc 0.1.0"], **extra}


TARGETS = [
    ("lib", "calc", LIB, True, False),
    ("bin", "tool", TOOL, True, False),
    ("test", "add_tests", ADD, True, False),
    ("test", "many", MANY, True, False),
    ("test", "dirt", DIRT, True, False),
]


def make(tmp_path, monkeypatch, targets=TARGETS, document=None):
    root = tmp_path / "r"

    for name in (LIB, TOOL, ADD, MANY, DIRT):
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("fn x() {}\n")

    bin_directory = tmp_path / "bin"
    bin_directory.mkdir(exist_ok=True)
    cargo = bin_directory / "cargo"
    cargo.write_text(FAKE_CARGO)
    cargo.chmod(cargo.stat().st_mode | stat.S_IEXEC)
    git_commit(root)
    canned = tmp_path / "metadata.json"
    canned.write_text(document if document is not None else json.dumps(metadata(root, targets)))
    monkeypatch.setenv("PATH", f"{bin_directory}:/usr/bin:/bin")
    monkeypatch.setenv("FAKE_LOG", str(tmp_path / "log"))
    monkeypatch.setenv("FAKE_METADATA", str(canned))

    for name in (
        "FAKE_FAIL",
        "FAKE_NO_REPORT",
        "FAKE_BAD_REPORT",
        "FAKE_METADATA_FAIL",
        "FAKE_COVER",
    ):
        monkeypatch.delenv(name, raising=False)

    scan = SimpleNamespace(language="rust", skip_paths=[], modules=[SimpleNamespace(files=[LIB])])

    return root, scan


@pytest.fixture(autouse=True)
def clean_map():
    RUST_UNITS.clear()
    yield
    RUST_UNITS.clear()


@pytest.mark.parametrize(
    ("unit", "flag"),
    [
        (("calc", "lib", "calc"), ["--lib"]),
        (("calc", "bin", "tool"), ["--bin", "tool"]),
        (("calc", "test", "many"), ["--test", "many"]),
    ],
)
def test_the_by_target_command_names_its_package_and_numbered_report(unit, flag):
    assert rust_by_target_command(3, unit) == [
        "cargo",
        "llvm-cov",
        "--lcov",
        "--output-path",
        ".recognizer/cache/coverage/rust/by-target/3.lcov",
        "-p",
        "calc",
        *flag,
    ]


@pytest.mark.parametrize(
    ("units", "expected"),
    [
        ([("calc", "test", "many")], ["-p", "calc", "--test", "many"]),
        (
            [("calc", "test", "many"), ("calc", "test", "dirt")],
            ["-p", "calc", "--test", "dirt", "--test", "many"],
        ),
        (
            [("calc", "lib", "calc"), ("calc", "test", "many")],
            ["-p", "calc", "--lib", "--test", "many"],
        ),
        (
            [("calc", "bin", "tool"), ("calc", "test", "add_tests")],
            ["-p", "calc", "--bin", "tool", "--test", "add_tests"],
        ),
        (
            [("zed", "lib", "zed"), ("calc", "lib", "calc")],
            ["-p", "calc", "-p", "zed", "--lib"],
        ),
    ],
)
def test_the_selected_command_repeats_packages_once_and_sorts_its_flags(units, expected):
    assert rust_selected_command(units) == ["cargo", "test", *expected]


def test_units_are_the_default_members_runnable_targets_named_by_path(tmp_path, monkeypatch):
    root, _ = make(tmp_path, monkeypatch)

    assert rust_units(root) == {
        LIB: ("calc", "lib", "calc"),
        TOOL: ("calc", "bin", "tool"),
        ADD: ("calc", "test", "add_tests"),
        MANY: ("calc", "test", "many"),
        DIRT: ("calc", "test", "dirt"),
    }


def test_gated_untested_bench_and_example_targets_are_not_units(tmp_path, monkeypatch):
    targets = [
        ("test", "many", MANY, True, False),
        ("test", "gated", ADD, True, True),
        ("lib", "calc", LIB, False, False),
        ("bench", "b", DIRT, True, False),
        ("example", "e", TOOL, True, False),
    ]
    root, _ = make(tmp_path, monkeypatch, targets)

    assert rust_units(root) == {MANY: ("calc", "test", "many")}


@pytest.mark.parametrize(
    ("targets", "reason"),
    [
        ([("test", "a", "../outside.rs", True, False)], "outside the repository"),
        (
            [("test", "a", MANY, True, False), ("test", "b", MANY, True, False)],
            "is named twice",
        ),
        ([("test", "bad name", MANY, True, False)], "unusable name"),
    ],
)
def test_an_unusable_target_makes_the_reader_name_why(tmp_path, monkeypatch, targets, reason):
    root, _ = make(tmp_path, monkeypatch, targets)

    assert reason in rust_units(root)


@pytest.mark.parametrize("document", ["not json", "{}", "[]"])
def test_unparsable_metadata_falls_back(tmp_path, monkeypatch, capsys, document):
    root, scan = make(tmp_path, monkeypatch, document=document)

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "running the whole suite for rust" in capsys.readouterr().err


def test_failing_metadata_falls_back(tmp_path, monkeypatch, capsys):
    root, scan = make(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_METADATA_FAIL", "1")

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "cargo metadata exited" in capsys.readouterr().err


def test_a_unit_outside_the_repository_is_named_and_drops_selection(tmp_path, monkeypatch, capsys):
    targets = [*TARGETS[:2], ("test", "far", "../far.rs", True, False)]
    root, scan = make(tmp_path, monkeypatch, targets)

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "far.rs is outside the repository" in capsys.readouterr().err


def test_the_pass_credits_each_line_to_the_units_whose_run_hit_it(tmp_path, monkeypatch):
    root, scan = make(tmp_path, monkeypatch)

    coverage, selection = collect_coverage_with_tests(root, [scan], None)

    assert selection[LIB] == {
        1: frozenset({TOOL, ADD}),
        5: frozenset({MANY, DIRT}),
        9: frozenset({MANY, LIB}),
    }
    assert coverage[LIB][5] == 1

    runs = (tmp_path / "log").read_text().splitlines()

    assert len([r for r in runs if r.startswith("llvm-cov")]) == 6
    assert any("-p calc --test many" in r for r in runs)


def test_a_selection_then_yields_the_covering_command(tmp_path, monkeypatch):
    root, scan = make(tmp_path, monkeypatch)
    collect_coverage_with_tests(root, [scan], None)

    assert selected_command(root, "rust", {MANY, DIRT}) == [
        "cargo",
        "test",
        "-p",
        "calc",
        "--test",
        "dirt",
        "--test",
        "many",
    ]
    assert selected_command(root, "rust", {MANY, LIB}) == [
        "cargo",
        "test",
        "-p",
        "calc",
        "--lib",
        "--test",
        "many",
    ]


def test_an_unmapped_empty_dashed_or_oversized_set_runs_the_whole_suite(tmp_path, monkeypatch):
    root, scan = make(tmp_path, monkeypatch)
    collect_coverage_with_tests(root, [scan], None)
    whole = mutant_command(root, "rust")

    assert selected_command(root, "rust", {"nope.rs"}) == whole
    assert selected_command(root, "rust", set()) == whole
    assert selected_command(root, "rust", {"-x"}) == whole

    many = {f"t{n}.rs" for n in range(profiles.MAX_SELECTED_FILES + 1)}

    for name in many:
        RUST_UNITS[name] = ("calc", "test", "x")

    assert selected_command(root, "rust", many) == whole


def test_a_failing_unit_run_falls_back(tmp_path, monkeypatch, capsys):
    root, scan = make(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_FAIL", "many")

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "running the whole suite for rust" in capsys.readouterr().err
    assert RUST_UNITS == {}


def test_a_missing_report_falls_back(tmp_path, monkeypatch, capsys):
    root, scan = make(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_NO_REPORT", "dirt")

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "no coverage report for tests/dirt/main.rs" in capsys.readouterr().err


def test_an_unreadable_report_falls_back(tmp_path, monkeypatch, capsys):
    root, scan = make(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_BAD_REPORT", "dirt")

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "no coverage report for tests/dirt/main.rs" in capsys.readouterr().err
    assert RUST_UNITS == {}


def test_a_repository_with_no_units_has_no_selection_and_prints_nothing(
    tmp_path, monkeypatch, capsys
):
    root, scan = make(tmp_path, monkeypatch, targets=[])

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert capsys.readouterr().err == ""


def test_the_reader_over_the_committed_rust_scanner_finds_twelve_units():
    root = Path(__file__).parents[2] / "scanners" / "rust"
    probe = subprocess.run(
        ["cargo", "metadata", "--no-deps", "--offline", "--format-version", "1"],
        cwd=root,
        capture_output=True,
        check=False,
    )

    if probe.returncode != 0:
        pytest.skip("cargo metadata is not available")

    units = rust_units(root)

    assert sorted(units) == sorted(
        [
            "src/lib.rs",
            "src/main.rs",
            *(
                f"tests/{name}.rs"
                for name in (
                    "abstractness",
                    "crates",
                    "entry_points",
                    "fixture_and_cli",
                    "limits",
                    "members",
                    "real_content",
                    "resolution",
                    "selection_and_schema",
                    "test_gate_cases",
                )
            ),
        ]
    )


CALC = """pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

pub fn mul(a: i32, b: i32) -> i32 {
    a * b
}

pub fn sub(a: i32, b: i32) -> i32 {
    a - b
}
"""


def mutation_world(tmp_path, monkeypatch, cover):
    root, _ = make(tmp_path, monkeypatch)
    (root / LIB).write_text(CALC)
    pristine = tmp_path / "pristine.rs"
    pristine.write_text(CALC)
    covered = tmp_path / "cover.txt"
    covered.write_text(
        "".join(f"{line} {unit}\n" for lines, units in cover for line in lines for unit in units)
    )
    git_commit(root)
    write_scan_document(root, "rust", [{"id": LIB}], [], [LIB])
    monkeypatch.setenv("FAKE_COVER", str(covered))
    monkeypatch.setenv("FAKE_PRISTINE", str(pristine))

    return root


def mutation_commands(tmp_path):
    log = tmp_path / "log"

    if not log.exists():
        return []

    return [
        line.removeprefix("MUTANT ")
        for line in log.read_text().splitlines()
        if line.startswith("MUTANT ")
    ]


ADD_LINES = (1, 2, 3)

MUL_LINES = (5, 6, 7)

SUB_LINES = (9, 10, 11)


def test_a_covering_set_of_two_of_five_units_is_selected_and_three_run_the_whole_suite(
    tmp_path, monkeypatch
):
    root = mutation_world(
        tmp_path,
        monkeypatch,
        [
            (ADD_LINES, ["add_tests", "tool"]),
            (MUL_LINES, ["many", "dirt", "add_tests"]),
            (SUB_LINES, ["lib", "many"]),
        ],
    )

    assert run_mutate(root, tmp_path / "overlay.json", json.dumps({"max_workers": 1})) == 0

    assert sorted(RUST_UNITS) == sorted([ADD, TOOL, MANY, DIRT, LIB])

    commands = set(mutation_commands(tmp_path))
    whole = " ".join(mutant_command(root, "rust")[1:])

    assert commands == {
        "test -p calc --bin tool --test add_tests",
        "test -p calc --lib --test many",
        whole,
    }


def test_a_test_target_edit_reruns_only_the_sites_it_covers_and_a_unit_site_reruns_only_when_its_crate_s_in_file_tests_change(
    tmp_path, monkeypatch
):
    root = mutation_world(
        tmp_path,
        monkeypatch,
        [
            (ADD_LINES, ["add_tests", "dirt"]),
            (MUL_LINES, ["many", "dirt"]),
            (SUB_LINES, ["lib"]),
        ],
    )
    settings = json.dumps({"max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    functions = read(root / RECORD)["functions"]
    sites = {name.rsplit("::", 1)[1]: len(entry["sites"]) for name, entry in functions.items()}

    assert sites["add"] > 0
    assert sites["mul"] > 0
    assert sites["sub"] > 0
    assert len(mutation_commands(tmp_path)) == sum(sites.values())

    (tmp_path / "log").write_text("")
    (root / MANY).write_text("fn x() { changed(); }\n")

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    commands = mutation_commands(tmp_path)

    assert commands.count("test -p calc --test dirt --test many") == sites["mul"]
    assert commands.count("test -p calc --lib") == 0
    assert len(commands) == sites["mul"]
    assert os.path.exists(root / RECORD)


def with_unit_tests(root, tmp_path, assertion):
    text = CALC + UNIT_TESTS.format(assertion=assertion)
    (root / LIB).write_text(text)
    (tmp_path / "pristine.rs").write_text(text)


UNIT_TESTS = """
#[cfg(test)]
mod tests {{
    #[test]
    fn unit_sub() {{
        assert_eq!(super::sub(3, 1), {assertion});
    }}
}}
"""


def test_an_in_file_test_edit_reruns_the_sites_its_unit_group_covers_and_a_deletion_does_too(
    tmp_path, monkeypatch
):
    root = mutation_world(
        tmp_path,
        monkeypatch,
        [
            (ADD_LINES, ["add_tests", "dirt"]),
            (MUL_LINES, ["many", "dirt"]),
            (SUB_LINES, ["lib"]),
        ],
    )
    with_unit_tests(root, tmp_path, 2)
    settings = json.dumps({"max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    functions = read(root / RECORD)["functions"]
    sites = {name.rsplit("::", 1)[1]: len(entry["sites"]) for name, entry in functions.items()}
    ran = functions[next(n for n in functions if n.endswith("::sub"))]["sites"][0]["ran"]

    assert list(ran) == [LIB]

    (tmp_path / "log").write_text("")

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert mutation_commands(tmp_path) == []

    with_unit_tests(root, tmp_path, 3)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    commands = mutation_commands(tmp_path)

    assert commands.count("test -p calc --lib") == sites["sub"]
    assert len(commands) == sites["sub"]

    (tmp_path / "log").write_text("")
    (root / LIB).write_text(CALC)
    (tmp_path / "pristine.rs").write_text(CALC)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert len(mutation_commands(tmp_path)) == sites["sub"]


def test_a_record_written_with_no_unit_hash_reruns_its_unit_sites_once_and_keeps_the_others(
    tmp_path, monkeypatch
):
    root = mutation_world(
        tmp_path,
        monkeypatch,
        [
            (ADD_LINES, ["add_tests", "dirt"]),
            (MUL_LINES, ["many", "dirt"]),
            (SUB_LINES, ["lib"]),
        ],
    )
    settings = json.dumps({"max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    record = read(root / RECORD)

    for name, entry in record["functions"].items():
        if name.endswith("::sub"):
            for site in entry["sites"]:
                site["ran"] = None
                site["killer"] = None
                site["tests"] = "old"

    (root / RECORD).write_text(json.dumps(record))
    sites = {n.rsplit("::", 1)[1]: len(e["sites"]) for n, e in record["functions"].items()}
    (tmp_path / "log").write_text("")

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert mutation_commands(tmp_path).count("test -p calc --lib") == sites["sub"]
    assert len(mutation_commands(tmp_path)) == sites["sub"]
