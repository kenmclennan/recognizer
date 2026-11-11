import json
import shutil
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from conftest import git_commit, write_scan_document
from test_mutation import run_mutate

from recognizer_sensors.mutation import commands, runner, sensor
from recognizer_sensors.mutation.commands import (
    CSHARP_CLASSES,
    csharp_class_command,
    csharp_filter,
    csharp_selected_command,
    mutant_command,
    selected_command,
)
from recognizer_sensors.mutation.warmup import (
    coverage_run,
    csharp_class_map,
    csharp_declarations,
)
from recognizer_sensors.testrun.suites import parse_suites


def suite_raw(tmp_path=None):
    return {
        "name": "shop",
        "language": "csharp",
        "directory": ".",
        **({"activate": f"export PATH={tmp_path / 'bin'}:$PATH"} if tmp_path else {}),
        "command": 'dotnet test --collect:"XPlat Code Coverage;Format=lcov"'
        " --results-directory TestResults",
        "coverage": {"path": "TestResults/*/coverage.info", "format": "lcov"},
    }


CSUITE = parse_suites([suite_raw()])[0]


def collect(root, scan, tmp_path):
    work = tmp_path / "work"
    work.mkdir(exist_ok=True)

    return coverage_run(root, [scan], parse_suites([suite_raw(tmp_path)]), work)


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")


CALC = "src/Calc.cs"

ADD = "tests/Calc.Tests/AddTests.cs"

MANY = "tests/Calc.Tests/Many.cs"

OUTER = "tests/Calc.Tests/Outer.cs"

FAKE_DOTNET = """#!/bin/sh
echo "$@" >> "$FAKE_LOG"
directory=""
filter=""
previous=""
for arg in "$@"; do
  [ "$previous" = "--results-directory" ] && directory="$arg"
  [ "$previous" = "--filter" ] && filter="$arg"
  previous="$arg"
done
mkdir -p "$directory/guid"
if [ -n "$filter" ]; then
  classes=$(echo "$filter" | tr '|' '\\n' | sed -e 's/FullyQualifiedName~//' -e 's/\\.$//')
  classes="$classes $FAKE_EXTRA"
else
  classes="$FAKE_CLASSES"
fi
{
  echo '<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"><Results>'
  for name in $classes; do
    echo "<UnitTestResult><TestMethod className=\\"$name\\"/></UnitTestResult>"
  done
  echo '</Results></TestRun>'
} > "$directory/results_x.trx"
hit() {
  for name in $classes; do
    case " $* " in *" $name "*) return 0 ;; esac
  done
  return 1
}
{
  echo "SF:$PWD/src/Calc.cs"
  for n in 5 7 9; do
    case "$n" in
      5) set -- P.Tests.AddTests P.Tests.OuterTests ;;
      7) set -- P.Tests.MulTests P.Tests.OuterTests+InnerTests ;;
      9) set -- P.Tests.NegTests ;;
    esac
    if [ -z "$filter" ] || hit "$@"; then echo "DA:$n,1"; else echo "DA:$n,0"; fi
  done
  echo end_of_record
} > "$directory/guid/coverage.info"
[ -n "$FAKE_FAIL" ] && [ -n "$filter" ] && exit 1
exit 0
"""

SOURCES = {
    CALC: "namespace P;\npublic class Calc { }\n",
    ADD: "namespace P.Tests;\n\npublic class AddTests\n{\n}\n",
    MANY: "namespace P.Tests\n{\n    public class MulTests { }\n\n    public class NegTests { }\n}\n",
    OUTER: "namespace P.Tests;\n\npublic class OuterTests\n{\n    public class InnerTests { }\n}\n",
}

ALL_CLASSES = "P.Tests.AddTests P.Tests.MulTests P.Tests.NegTests P.Tests.OuterTests P.Tests.OuterTests+InnerTests"


def make(tmp_path, monkeypatch, files=None, classes=ALL_CLASSES):
    root = tmp_path / "r"

    for name, text in (files or SOURCES).items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    bin_directory = tmp_path / "bin"
    bin_directory.mkdir(exist_ok=True)
    dotnet = bin_directory / "dotnet"
    dotnet.write_text(FAKE_DOTNET)
    dotnet.chmod(dotnet.stat().st_mode | stat.S_IEXEC)
    git_commit(root)
    monkeypatch.setenv("PATH", f"{bin_directory}:/usr/bin:/bin")
    monkeypatch.setenv("FAKE_LOG", str(tmp_path / "log"))
    monkeypatch.setenv("FAKE_CLASSES", classes)
    monkeypatch.delenv("FAKE_EXTRA", raising=False)
    monkeypatch.delenv("FAKE_FAIL", raising=False)
    scan = SimpleNamespace(
        language="csharp", skip_paths=[], modules=[SimpleNamespace(files=[CALC])]
    )

    return root, scan


@pytest.fixture(autouse=True)
def clean_map():
    CSHARP_CLASSES.clear()
    yield
    CSHARP_CLASSES.clear()


@pytest.mark.parametrize(
    ("classes", "expected"),
    [
        (["P.Tests.A"], "FullyQualifiedName~P.Tests.A."),
        (
            ["P.Tests.B", "P.Tests.A"],
            "FullyQualifiedName~P.Tests.A.|FullyQualifiedName~P.Tests.B.",
        ),
        (["P.O+I", "P.O"], "FullyQualifiedName~P.O.|FullyQualifiedName~P.O+I."),
    ],
)
def test_the_filter_ends_every_clause_in_a_dot_and_sorts_them(classes, expected):
    assert csharp_filter(classes) == expected


def test_the_by_file_command_is_an_argument_vector():
    assert csharp_class_command(3, ["P.A", "P.A+B"]) == [
        "dotnet",
        "test",
        "--collect:XPlat Code Coverage;Format=lcov",
        "--results-directory",
        ".recognizer/cache/coverage/csharp/by-file/3",
        "--logger",
        "trx;LogFilePrefix=results",
        "--filter",
        "FullyQualifiedName~P.A.|FullyQualifiedName~P.A+B.",
    ]


def test_the_selected_command_carries_only_the_filter():
    assert csharp_selected_command(["P.A"]) == [
        "dotnet",
        "test",
        "--filter",
        "FullyQualifiedName~P.A.",
    ]


def test_a_mapped_file_selects_its_classes_and_anything_else_the_whole_suite():
    CSHARP_CLASSES["t/X.cs"] = ["P.X"]
    whole = mutant_command(CSUITE)

    assert selected_command(CSUITE, {"t/X.cs"}) == [
        "dotnet",
        "test",
        "--filter",
        "FullyQualifiedName~P.X.",
    ]
    assert selected_command(CSUITE, {"t/Y.cs"}) == whole
    assert selected_command(CSUITE, {"t/X.cs", "t/Y.cs"}) == whole
    assert selected_command(CSUITE, set()) == whole
    assert selected_command(CSUITE, {"-x"}) == whole


def test_more_than_the_file_limit_runs_the_whole_suite():
    many = {f"t/T{n}.cs" for n in range(commands.MAX_SELECTED_FILES + 1)}

    for name in many:
        CSHARP_CLASSES[name] = ["P.T"]

    assert selected_command(CSUITE, many) == mutant_command(CSUITE)


def test_declarations_read_block_and_file_scoped_namespaces_and_nesting(tmp_path):
    files = {
        "a/Deep.cs": "namespace A.B.C\n{\n    class Deep { class In { } }\n}\n",
        "a/Top.cs": "namespace A { namespace B { class Top { } } }\n",
        "a/Rec.cs": "namespace R;\nrecord Rec(int X);\nstruct S { }\n",
    }
    root = tmp_path / "d"

    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)

    git_commit(root)
    declared = csharp_declarations(root, {"A.B.C.Deep", "A.B.Top", "R.Rec", "R.S", "A.B.C.Deep+In"})

    assert declared == {
        "A.B.C.Deep": ["a/Deep.cs"],
        "A.B.C.Deep+In": ["a/Deep.cs"],
        "A.B.Top": ["a/Top.cs"],
        "R.Rec": ["a/Rec.cs"],
        "R.S": ["a/Rec.cs"],
    }


def test_the_class_map_groups_classes_by_declaring_file(tmp_path, monkeypatch):
    root, _ = make(tmp_path, monkeypatch)

    assert csharp_class_map(root, set(ALL_CLASSES.split())) == {
        ADD: ["P.Tests.AddTests"],
        MANY: ["P.Tests.MulTests", "P.Tests.NegTests"],
        OUTER: ["P.Tests.OuterTests", "P.Tests.OuterTests+InnerTests"],
    }


def test_the_pass_attributes_each_line_to_the_files_whose_run_hit_it(tmp_path, monkeypatch):
    root, scan = make(tmp_path, monkeypatch)

    coverage, selection = collect(root, scan, tmp_path)

    assert selection[CALC] == {
        5: frozenset({ADD, OUTER}),
        7: frozenset({MANY, OUTER}),
        9: frozenset({MANY}),
    }
    assert coverage[CALC][5] == 1

    runs = (tmp_path / "log").read_text().splitlines()

    assert "--logger trx;LogFilePrefix=results" in runs[0]
    assert len(runs) == 4
    assert any(
        "--filter FullyQualifiedName~P.Tests.MulTests.|FullyQualifiedName~P.Tests.NegTests." in r
        for r in runs
    )
    assert CSHARP_CLASSES[MANY] == ["P.Tests.MulTests", "P.Tests.NegTests"]


def test_a_selection_then_yields_the_covering_command(tmp_path, monkeypatch):
    root, scan = make(tmp_path, monkeypatch)
    collect(root, scan, tmp_path)

    assert selected_command(CSUITE, {MANY}) == [
        "dotnet",
        "test",
        "--filter",
        "FullyQualifiedName~P.Tests.MulTests.|FullyQualifiedName~P.Tests.NegTests.",
    ]


def test_a_repository_with_no_tests_has_no_selection_and_prints_nothing(
    tmp_path, monkeypatch, capsys
):
    root, scan = make(tmp_path, monkeypatch, classes="")

    assert collect(root, scan, tmp_path)[1] == {}
    assert capsys.readouterr().err == ""


@pytest.mark.parametrize("extra", ["P.Tests.Ghost", "P.Tests.Gen`1"])
def test_a_class_with_no_file_or_an_odd_name_names_itself_and_falls_back(
    tmp_path, monkeypatch, capsys, extra
):
    root, scan = make(tmp_path, monkeypatch, classes=f"{ALL_CLASSES} {extra}")

    assert collect(root, scan, tmp_path)[1] == {}
    assert (
        f"recognizer-sensors: mutation: test class {extra} has no single test file; "
        "running the whole suite for csharp"
    ) in capsys.readouterr().err
    assert not CSHARP_CLASSES


def test_a_partial_class_in_two_files_falls_back(tmp_path, monkeypatch, capsys):
    files = {**SOURCES, "tests/Calc.Tests/Add2.cs": SOURCES[ADD]}
    root, scan = make(tmp_path, monkeypatch, files=files)

    assert collect(root, scan, tmp_path)[1] == {}
    assert "P.Tests.AddTests has no single test file" in capsys.readouterr().err


def test_a_failing_per_file_run_falls_back(tmp_path, monkeypatch, capsys):
    root, scan = make(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_FAIL", "1")

    assert collect(root, scan, tmp_path)[1] == {}
    assert "running the whole suite for csharp" in capsys.readouterr().err
    assert not CSHARP_CLASSES


def test_a_run_that_executed_another_class_falls_back(tmp_path, monkeypatch, capsys):
    root, scan = make(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_EXTRA", "Other.P.Tests.AddTests")

    assert collect(root, scan, tmp_path)[1] == {}
    assert "did not execute exactly its classes; running the whole suite for csharp" in (
        capsys.readouterr().err
    )


def test_the_declaration_reader_over_the_committed_csharp_sample(tmp_path):
    sample = Path(__file__).parents[2] / "fixtures" / "csharp" / "sample"
    root = tmp_path / "s"
    shutil.copytree(sample, root)
    git_commit(root)
    names = {
        "Shop.Checks.CheckXunit",
        "Shop.Checks.CheckFlag",
        "Shop.Checks.CheckMSTest",
        "Shop.Checks.CheckMvc",
        "Shop.Checks.CheckSdk",
        "Shop.Checks.CheckUnitTests",
    }
    declared = csharp_declarations(root, names)

    assert set(declared) >= names
    assert all(len(declared[name]) == 1 for name in names)


def dotnet_runs() -> bool:
    try:
        return subprocess.run(["dotnet", "--version"], capture_output=True).returncode == 0
    except OSError:
        return False


@pytest.mark.skipif(not dotnet_runs(), reason="needs a .NET SDK and NuGet access")
def test_real_dotnet_selection_on_the_committed_fixture(tmp_path, monkeypatch):
    dotnet_scratch = tmp_path / "dotnet-tmp"
    dotnet_scratch.mkdir()
    monkeypatch.setenv("TMPDIR", str(dotnet_scratch))
    root = tmp_path / "c"
    shutil.copytree(Path(__file__).parents[2] / "fixtures" / "mutation" / "csharp", root)
    git_commit(root)
    calc = "Calc/Calc.cs"
    scan = SimpleNamespace(
        language="csharp", skip_paths=[], modules=[SimpleNamespace(files=[calc])]
    )
    add, many, outer = (f"Calc.Tests/{n}.cs" for n in ("AddTests", "Many", "Outer"))

    _, selection = collect(root, scan, tmp_path)

    assert selection[calc] == {
        5: frozenset({add, outer}),
        7: frozenset({many, outer}),
        9: frozenset({many}),
    }


CS_CALC = "src/Calc.cs"

CS_SOURCE = (
    "class Calc {\n"
    "    int A(int x) {\n        return x + 1;\n    }\n"
    "    int B(int x) {\n        return x - 1;\n    }\n"
    "    int C(int x) {\n        return x * 2;\n    }\n}\n"
)

CS_TESTS = [f"tests/T{n}.cs" for n in range(4)]


def test_a_selection_of_half_the_suite_is_used_and_one_more_file_runs_the_whole_suite(
    tmp_path, monkeypatch
):
    root = tmp_path / "r"
    (root / "src").mkdir(parents=True)
    (root / CS_CALC).write_text(CS_SOURCE)
    git_commit(root)
    write_scan_document(root, "csharp", [{"id": CS_CALC}], [], [CS_CALC])

    for index, name in enumerate(CS_TESTS):
        CSHARP_CLASSES[name] = [f"P.T{index}"]

    selection = {
        CS_CALC: {
            3: frozenset(CS_TESTS[:2]),
            6: frozenset(CS_TESTS[:3]),
            9: frozenset(CS_TESTS[3:]),
        }
    }
    monkeypatch.setattr(
        sensor,
        "coverage_run",
        lambda repository, scans, suites, work, **_: ({CS_CALC: {3: 1, 6: 1, 9: 1}}, selection),
    )
    seen = []

    def spy(command, cwd, timeout, suite=None, extra=None):
        seen.append(list(command))

        return runner.TestRun(0, False, 0.1, "")

    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = json.dumps({"tests": [suite_raw()], "incremental": False, "max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    half = ["dotnet", "test", "--filter", "FullyQualifiedName~P.T0.|FullyQualifiedName~P.T1."]

    assert half in seen
    assert mutant_command(CSUITE) in seen
    assert not any("P.T2." in " ".join(command) for command in seen)
