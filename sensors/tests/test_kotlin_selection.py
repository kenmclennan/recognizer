import json
import shutil
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from conftest import git_commit, write_scan_document
from test_mutation import run_mutate

from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.settings import Refusal
from recognizer_sensors.testrun import profiles
from recognizer_sensors.testrun.profiles import (
    KOTLIN_CLASSES,
    kotlin_by_file_command,
    kotlin_selected_command,
    mutant_command,
    selected_command,
)
from recognizer_sensors.testrun.run import (
    collect_coverage_with_tests,
    kotlin_class_map,
)

REPORT = "build/reports/jacoco/test/jacocoTestReport.xml"

CALC = "src/main/kotlin/p/Calc.kt"

ADD = "src/test/kotlin/p/AddTest.kt"

MANY = "src/test/kotlin/p/Many.kt"

OUTER = "src/test/kotlin/p/Outer.kt"

FAKE_GRADLE = """#!/bin/sh
echo "$@" >> "$FAKE_LOG"
echo "$GRADLE_USER_HOME" >> "$FAKE_HOMES"
case " $* " in
  *" --stop "*) [ -n "$FAKE_STOP_FAIL" ] && exit 1; exit 0 ;;
  *" --tests "*)
    mkdir -p build/reports/jacoco/test
    lines=""
    for arg in "$@"; do
      case "$arg" in
        p.AddTest|p.OuterTest) lines="$lines 4" ;;
      esac
      case "$arg" in
        p.MulTest|p.NegTest|p.OuterTest) lines="$lines 8" ;;
      esac
      case "$arg" in
        p.NegTest) lines="$lines 12" ;;
      esac
    done
    [ -n "$FAKE_FAIL" ] && exit 1
    [ -n "$FAKE_NO_REPORT" ] && exit 0
    {
      echo '<report name="x"><package name="p"><sourcefile name="Calc.kt">'
      for n in 4 8 12; do
        case " $lines " in
          *" $n "*) echo "<line nr=\\"$n\\" mi=\\"0\\" ci=\\"1\\"/>" ;;
          *) echo "<line nr=\\"$n\\" mi=\\"1\\" ci=\\"0\\"/>" ;;
        esac
      done
      echo '</sourcefile></package></report>'
    } > build/reports/jacoco/test/jacocoTestReport.xml
    ;;
  *)
    mkdir -p build/test-results/test build/reports/jacoco/test
    for name in $FAKE_CLASSES; do
      : > "build/test-results/test/TEST-$name.xml"
    done
    {
      echo '<report name="x"><package name="p"><sourcefile name="Calc.kt">'
      for n in 4 8 12; do echo "<line nr=\\"$n\\" mi=\\"0\\" ci=\\"1\\"/>"; done
      echo '</sourcefile></package></report>'
    } > build/reports/jacoco/test/jacocoTestReport.xml
    dumps=""
    for arg in "$@"; do
      case "$arg" in
        -Drecognizer.dumps=*) dumps="${arg#-Drecognizer.dumps=}" ;;
      esac
    done
    if [ -n "$dumps" ] && [ -z "$FAKE_LISTENER_FAIL" ]; then
      mkdir -p "$dumps/~"
      printf 'p/Calc.kt\t4\n' > "$dumps/~/p.AddTest.lines"
      printf 'p/Calc.kt\t8\n' > "$dumps/~/p.MulTest.lines"
      printf 'p/Calc.kt\t8,12\n' > "$dumps/~/p.NegTest.lines"
      printf 'p/Calc.kt\t4,8\n' > "$dumps/~/p.OuterTest.lines"
      printf 'p/Calc.kt\t4\n' > "$dumps/~/p.AddTest.exec"
    fi
    ;;
esac
"""

SOURCES = {
    CALC: "package p\n\nclass Calc\n",
    ADD: "package p\n\nclass AddTest {\n}\n",
    MANY: "package p\n\nclass MulTest {\n}\n\nclass NegTest {\n}\n",
    OUTER: 'package p\n\n@Suppress("x")\nclass OuterTest {\n    inner class InnerTest\n}\n',
}

ALL_CLASSES = "p.AddTest p.MulTest p.NegTest p.OuterTest p.OuterTest$InnerTest"


def make(tmp_path, files=None, classes=ALL_CLASSES, monkeypatch=None):
    root = tmp_path / "r"

    for name, text in (files or SOURCES).items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    gradlew = root / "gradlew"
    gradlew.write_text(FAKE_GRADLE)
    gradlew.chmod(gradlew.stat().st_mode | stat.S_IEXEC)
    git_commit(root)
    monkeypatch.setenv("FAKE_LOG", str(tmp_path / "log"))
    monkeypatch.setenv("FAKE_HOMES", str(tmp_path / "homes"))
    monkeypatch.setenv("FAKE_CLASSES", classes)
    scan = SimpleNamespace(
        language="kotlin",
        modules=[SimpleNamespace(files=[CALC])],
    )

    return root, scan


@pytest.mark.parametrize(
    ("project", "classes", "expected"),
    [
        ("", ["p.A"], ["./gradlew", "test", "--rerun", "--tests", "p.A", "jacocoTestReport"]),
        (
            ":a:b",
            ["p.A", "p.B"],
            [
                "./gradlew",
                ":a:b:test",
                "--rerun",
                "--tests",
                "p.A",
                "--tests",
                "p.B",
                ":a:b:jacocoTestReport",
            ],
        ),
    ],
)
def test_the_by_file_command_puts_the_filters_after_the_test_task(project, classes, expected):
    assert kotlin_by_file_command(project, classes) == expected


def test_the_selected_command_joins_projects_in_sorted_order():
    assert kotlin_selected_command([(":b", "b.B"), ("", "r.R"), (":a", "z.Z"), (":a", "a.A")]) == [
        "./gradlew",
        "test",
        "--tests",
        "r.R",
        ":a:test",
        "--tests",
        "a.A",
        "--tests",
        "z.Z",
        ":b:test",
        "--tests",
        "b.B",
    ]


def test_a_root_project_selection_runs_gradle_test_with_the_filter(tmp_path):
    KOTLIN_CLASSES.clear()
    KOTLIN_CLASSES["t/XTest.kt"] = [("", "p.XTest")]

    assert selected_command(tmp_path, "kotlin", {"t/XTest.kt"}) == [
        "./gradlew",
        "test",
        "--tests",
        "p.XTest",
    ]

    KOTLIN_CLASSES.clear()


def test_kotlin_stop_adds_fail_fast_after_each_test_task(tmp_path):
    KOTLIN_CLASSES.clear()
    KOTLIN_CLASSES["t/XTest.kt"] = [(":a", "p.XTest"), (":b", "q.XTest")]

    assert mutant_command(tmp_path, "kotlin", stop=True) == ["./gradlew", "test", "--fail-fast"]
    assert selected_command(tmp_path, "kotlin", {"t/XTest.kt"}, stop=True) == [
        "./gradlew",
        ":a:test",
        "--fail-fast",
        "--tests",
        "p.XTest",
        ":b:test",
        "--fail-fast",
        "--tests",
        "q.XTest",
    ]
    assert selected_command(tmp_path, "kotlin", {"t/Other.kt"}, stop=True) == [
        "./gradlew",
        "test",
        "--fail-fast",
    ]
    assert "--fail-fast" not in selected_command(tmp_path, "kotlin", {"t/XTest.kt"})

    KOTLIN_CLASSES.clear()


def test_a_file_missing_from_the_map_or_a_dashed_name_runs_the_whole_suite(tmp_path):
    KOTLIN_CLASSES.clear()
    KOTLIN_CLASSES["t/XTest.kt"] = [("", "p.XTest")]
    whole = mutant_command(tmp_path, "kotlin")

    assert selected_command(tmp_path, "kotlin", {"t/Other.kt"}) == whole
    assert selected_command(tmp_path, "kotlin", {"t/XTest.kt", "t/Other.kt"}) == whole
    assert selected_command(tmp_path, "kotlin", set()) == whole
    assert selected_command(tmp_path, "kotlin", {"-x"}) == whole

    KOTLIN_CLASSES.clear()


def test_more_than_the_file_limit_runs_the_whole_suite(tmp_path):
    KOTLIN_CLASSES.clear()
    many = {f"t/T{n}Test.kt" for n in range(profiles.MAX_SELECTED_FILES + 1)}

    for name in many:
        KOTLIN_CLASSES[name] = [("", name)]

    assert selected_command(tmp_path, "kotlin", many) == mutant_command(tmp_path, "kotlin")

    KOTLIN_CLASSES.clear()


def test_rust_selected_command_falls_back_to_the_whole_suite_for_an_unmapped_file(tmp_path):
    assert selected_command(tmp_path, "rust", {"a"}) == ["cargo", "test"]


def test_nested_classes_belong_to_their_outermost_files_run(tmp_path, monkeypatch):
    root, _ = make(tmp_path, monkeypatch=monkeypatch)
    subprocess.run([str(root / "gradlew")], cwd=root, check=True)

    mapped = kotlin_class_map(root)

    assert mapped == {
        ADD: [("", "p.AddTest")],
        MANY: [("", "p.MulTest"), ("", "p.NegTest")],
        OUTER: [("", "p.OuterTest")],
    }


def test_the_pass_attributes_each_line_to_the_files_whose_run_hit_it(tmp_path, monkeypatch):
    root, scan = make(tmp_path, monkeypatch=monkeypatch)

    coverage, selection = collect_coverage_with_tests(root, [scan], None)

    assert selection[CALC] == {
        4: frozenset({ADD, OUTER}),
        8: frozenset({MANY, OUTER}),
        12: frozenset({MANY}),
    }
    assert coverage[CALC][4] == 1

    runs = (tmp_path / "log").read_text().splitlines()

    assert len(runs) == 1
    assert "--init-script" in runs[0]
    assert runs[0].endswith("test --rerun jacocoTestReport")
    assert KOTLIN_CLASSES[MANY] == [("", "p.MulTest"), ("", "p.NegTest")]
    assert leftovers(root) == []


def leftovers(root):
    cache = root / ".recognizer/cache"

    return sorted(
        p.name for p in cache.rglob("*") if p.is_file() and p.suffix in (".exec", ".lines", ".xml")
    ) + [p.name for p in cache.rglob("by-file")]


def test_the_per_file_fallback_attributes_each_line_and_leaves_nothing_behind(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("FAKE_LISTENER_FAIL", "1")
    root, scan = make(tmp_path, monkeypatch=monkeypatch)

    _, selection = collect_coverage_with_tests(root, [scan], None)

    assert selection[CALC] == {
        4: frozenset({ADD, OUTER}),
        8: frozenset({MANY, OUTER}),
        12: frozenset({MANY}),
    }

    runs = (tmp_path / "log").read_text().splitlines()

    assert len(runs) == 4
    assert "test --rerun --tests p.MulTest --tests p.NegTest jacocoTestReport" in runs
    assert leftovers(root) == []


def test_the_per_file_run_deletes_no_report_and_ignores_one_it_did_not_write(tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_NO_REPORT", "1")
    monkeypatch.setenv("FAKE_LISTENER_FAIL", "1")
    root, scan = make(tmp_path, monkeypatch=monkeypatch)

    _, selection = collect_coverage_with_tests(root, [scan], None)

    assert (root / REPORT).is_file()
    assert selection == {}
    assert leftovers(root) == []


def test_a_selection_then_yields_the_covering_command(tmp_path, monkeypatch):
    root, scan = make(tmp_path, monkeypatch=monkeypatch)
    collect_coverage_with_tests(root, [scan], None)

    assert selected_command(root, "kotlin", {MANY}) == [
        "./gradlew",
        "test",
        "--tests",
        "p.MulTest",
        "--tests",
        "p.NegTest",
    ]


def test_a_class_with_no_file_leaves_no_selection_and_names_it(tmp_path, monkeypatch, capsys):
    root, scan = make(tmp_path, classes=ALL_CLASSES + " p.Ghost", monkeypatch=monkeypatch)

    _, selection = collect_coverage_with_tests(root, [scan], None)

    assert selection == {}
    assert (
        "recognizer-sensors: mutation: test class p.Ghost has no single test file; "
        "running the whole suite for kotlin"
    ) in capsys.readouterr().err
    assert not KOTLIN_CLASSES


def test_two_files_declaring_one_class_or_a_package_less_file_fall_back(
    tmp_path, monkeypatch, capsys
):
    files = {**SOURCES, "src/test/kotlin/p/AddTest2.kt": SOURCES[ADD]}
    root, scan = make(tmp_path, files=files, monkeypatch=monkeypatch)

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "p.AddTest has no single test file" in capsys.readouterr().err

    files = {**SOURCES, ADD: "class AddTest {\n}\n"}
    root, scan = make(tmp_path / "b", files=files, monkeypatch=monkeypatch)

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "p.AddTest has no single test file" in capsys.readouterr().err


@pytest.mark.parametrize("variable", ["FAKE_FAIL", "FAKE_NO_REPORT"])
def test_a_failing_or_reportless_run_leaves_no_selection(tmp_path, monkeypatch, capsys, variable):
    root, scan = make(tmp_path, monkeypatch=monkeypatch)
    whole = (root / "gradlew").read_text()
    monkeypatch.setenv(variable, "1")
    monkeypatch.setenv("FAKE_LISTENER_FAIL", "1")

    _, selection = collect_coverage_with_tests(root, [scan], None)

    assert (root / "gradlew").read_text() == whole
    assert selection == {}
    assert "running the whole suite for kotlin" in capsys.readouterr().err
    assert not KOTLIN_CLASSES


def test_an_unmapped_class_among_three_files_names_that_class(tmp_path, monkeypatch, capsys):
    root, scan = make(tmp_path, classes=ALL_CLASSES + " p.Weird", monkeypatch=monkeypatch)
    (root / "src/test/kotlin/p/Weird.kt").write_text("package p\nclass A; class Weird\n")
    git_commit_again(root)

    assert collect_coverage_with_tests(root, [scan], None)[1] == {}
    assert "p.Weird" in capsys.readouterr().err


def git_commit_again(root: Path) -> None:
    shutil.rmtree(root / ".git")
    git_commit(root)


def test_the_class_map_over_the_committed_kotlin_sample(tmp_path, monkeypatch):
    sample = Path(__file__).parents[2] / "fixtures" / "kotlin" / "sample"
    root = tmp_path / "s"
    shutil.copytree(sample, root)
    git_commit(root)
    results = root / "app/build/test-results/test"
    results.mkdir(parents=True)
    (results / "TEST-shop.web.OrderControllerTest.xml").write_text("")

    mapped = kotlin_class_map(root)
    [(file, pairs)] = mapped.items()

    assert file.endswith("OrderControllerTest.kt")
    assert pairs == [(":app", "shop.web.OrderControllerTest")]


def test_a_subproject_result_directory_names_its_gradle_project(tmp_path, monkeypatch):
    files = {
        "a/src/test/kotlin/p/XTest.kt": "package p\n\nclass XTest\n",
    }
    root, _ = make(tmp_path, files=files, monkeypatch=monkeypatch)
    results = root / "a/build/test-results/test"
    results.mkdir(parents=True)
    (results / "TEST-p.XTest.xml").write_text("")

    assert kotlin_class_map(root) == {"a/src/test/kotlin/p/XTest.kt": [(":a", "p.XTest")]}


@pytest.fixture(autouse=True)
def clean_map():
    KOTLIN_CLASSES.clear()
    yield
    KOTLIN_CLASSES.clear()


def gradle_runs() -> bool:
    try:
        return subprocess.run(["gradle", "--version"], capture_output=True).returncode == 0
    except OSError:
        return False


@pytest.mark.skipif(not gradle_runs(), reason="needs gradle on PATH")
def test_real_gradle_selection_on_the_committed_fixture(tmp_path):
    root = tmp_path / "k"
    shutil.copytree(Path(__file__).parents[2] / "fixtures" / "mutation" / "kotlin", root)
    wrapper = root / "gradlew"
    wrapper.write_text('#!/bin/sh\nexec gradle "$@"\n')
    wrapper.chmod(wrapper.stat().st_mode | stat.S_IEXEC)
    git_commit(root)
    calc = "src/main/kotlin/p/Calc.kt"
    scan = SimpleNamespace(language="kotlin", modules=[SimpleNamespace(files=[calc])])

    try:
        _, selection = collect_coverage_with_tests(root, [scan], None)
    except Refusal as refusal:
        log = root / ".recognizer" / "cache" / "coverage" / "last-run.log"
        text = log.read_text(errors="replace") if log.exists() else "no log written"
        pytest.fail(f"{refusal}\n{text[-6000:]}")

    add, many, outer = ADD, MANY, OUTER
    assert selection[calc] == {
        5: frozenset({add, outer}),
        9: frozenset({many, outer}),
        13: frozenset({many}),
    }


KT_CALC = "src/main/kotlin/p/Calc.kt"

KT_SOURCE = "package p\n\nfun a(x: Int): Int {\n    return x + 1\n}\n\nfun b(x: Int): Int {\n    return x - 1\n}\n\nfun c(x: Int): Int {\n    return x * 2\n}\n"

KT_TESTS = [f"src/test/kotlin/p/T{n}Test.kt" for n in range(4)]


def test_a_kotlin_selection_of_half_the_suite_is_used_and_one_more_file_runs_the_whole_suite(
    tmp_path, monkeypatch
):
    root = tmp_path / "r"
    (root / "src/main/kotlin/p").mkdir(parents=True)
    (root / KT_CALC).write_text(KT_SOURCE)
    git_commit(root)
    write_scan_document(root, "kotlin", [{"id": KT_CALC}], [], [KT_CALC])

    for index, name in enumerate(KT_TESTS):
        KOTLIN_CLASSES[name] = [("", f"p.T{index}Test")]

    selection = {
        KT_CALC: {
            4: frozenset(KT_TESTS[:2]),
            8: frozenset(KT_TESTS[:3]),
            12: frozenset(KT_TESTS[3:]),
        }
    }
    monkeypatch.setattr(
        sensor,
        "collect_coverage_with_tests",
        lambda repository, scans, coverage: ({KT_CALC: {4: 1, 8: 1, 12: 1}}, selection),
    )
    seen = []

    def spy(command, cwd, timeout):
        seen.append(list(command))

        return runner.TestRun(0, False, 0.1, "")

    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = json.dumps({"incremental": False, "max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    half = ["./gradlew", "test", "--tests", "p.T0Test", "--tests", "p.T1Test"]
    whole = mutant_command(root, "kotlin")

    assert half in seen
    assert whole in seen
    assert not any("p.T2Test" in command for command in seen)
    assert all(command[:2] == ["./gradlew", "test"] for command in seen)
