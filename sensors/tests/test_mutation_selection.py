import contextlib
import hashlib
import json
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

import pytest
from conftest import (
    event_lines,
    git_commit,
    make_repository,
    mutate_repository,
    mutate_settings,
    python_suite,
    wait_for_pid,
)
from coverage import CoverageData
from test_mutation import RECORD, SURVIVORS, read, run_mutate

from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.mutation.commands import (
    MAX_SELECTED_NODES,
    mutant_command,
    selected_command,
)
from recognizer_sensors.mutation.warmup import coverage_run
from recognizer_sensors.scans import read_scans
from recognizer_sensors.settings import Refusal
from recognizer_sensors.testrun.contexts import PYTHON_DATA, ContextSelection, PythonContexts
from recognizer_sensors.testrun.suites import parse_suites


def suite_of(language="python", runner_name=None, directory=".", **extra):
    raw = {
        "name": "api",
        "language": language,
        "directory": directory,
        "command": "true",
        "coverage": {"path": "cov.info", "format": "lcov"},
        **extra,
    }

    if runner_name:
        raw["runner"] = runner_name

    return parse_suites([raw])[0]


SUITE = suite_of()


def as_seen(command):
    return command if isinstance(command, str) else list(command)


def as_seen_key(command):
    return command if isinstance(command, str) else tuple(command)


SUITES = [asdict(parse_suites([python_suite("tests/strong.py")])[0])]


def strong_settings(**extra):
    return json.dumps({"tests": [python_suite("tests/strong.py")], **extra})


SHOP = """import os

TAX = 2


def clamp(x):
    return min(x, 10)


def total(items):
    return sum(items)


def shared(x):
    return x + 1


def other(x):
    return x * 2
"""

TEST_A = """from app.shop import clamp, shared


def test_clamp():
    assert clamp(20) == 10


def test_shared():
    assert shared(1) == 2
"""

TEST_B = """import pytest

from app.shop import shared, total


@pytest.fixture
def items():
    return total([1, 2])


def test_total(items):
    assert items == 3


def test_shared():
    assert shared(2) == 3
"""


def write_data(root, contexts):
    data = CoverageData(basename=str(root / PYTHON_DATA))
    (root / PYTHON_DATA).parent.mkdir(parents=True, exist_ok=True)

    for context, lines in contexts:
        data.set_context(context)
        data.add_lines({str(root / "app" / "m.py"): lines})

    data.write()


def test_the_context_reader_keeps_only_lines_whose_every_context_is_an_existing_file(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "m.py").write_text("")
    (tmp_path / "tests" / "test_a.py").write_text("")
    (tmp_path / "tests" / "test_b.py").write_text("")
    write_data(
        tmp_path,
        [
            ("tests/test_a.py", [1, 2, 6]),
            ("tests/test_b.py", [2]),
            ("", [3, 6]),
            ("test_a.test_one", [4]),
            ("tests/missing.py", [5]),
        ],
    )

    assert ContextSelection({}, PythonContexts(tmp_path))["app/m.py"] == {
        1: frozenset({"tests/test_a.py"}),
        2: frozenset({"tests/test_a.py", "tests/test_b.py"}),
        6: frozenset({"tests/test_a.py"}),
    }


def test_an_unreadable_coverage_data_file_selects_nothing(tmp_path, capsys):
    (tmp_path / PYTHON_DATA).parent.mkdir(parents=True)
    (tmp_path / PYTHON_DATA).write_bytes(b"not sqlite")

    assert dict(ContextSelection({}, PythonContexts(tmp_path))) == {}
    assert capsys.readouterr().err.count("could not be read") == 1


def test_a_missing_context_file_selects_nothing(tmp_path):
    assert dict(ContextSelection({}, PythonContexts(tmp_path))) == {}


def test_python_selection_is_pytest_on_the_covering_files():
    assert selected_command(SUITE, {"tests/b.py", "tests/a.py"}) == [
        "pytest",
        "-rfE",
        "tests/a.py",
        "tests/b.py",
    ]


def test_python_selection_names_files_relative_to_the_suite_directory():
    nested = suite_of(directory="service")

    assert selected_command(nested, {"service/tests/b.py", "service/tests/a.py"}) == [
        "pytest",
        "-rfE",
        "tests/a.py",
        "tests/b.py",
    ]
    assert selected_command(nested, {"other/tests/a.py"}) == mutant_command(nested)


def test_typescript_selection_is_the_runners_related_command():
    vitest = suite_of("typescript", "vitest")
    jest = suite_of("typescript", "jest")

    assert selected_command(vitest, None, file="web/a.ts") == [
        "npx",
        "--no",
        "--",
        "vitest",
        "related",
        "web/a.ts",
        "--run",
    ]
    assert selected_command(jest, None, file="web/a.ts") == [
        "npx",
        "--no",
        "--",
        "jest",
        "--findRelatedTests",
        "web/a.ts",
    ]
    assert mutant_command(vitest) == vitest.command
    assert mutant_command(jest) == jest.command


def test_a_previous_killer_file_leads_the_python_selected_command():
    files = {"tests/a.py", "tests/b.py", "tests/c.py"}

    assert selected_command(
        SUITE, files, stop=True, previous=frozenset({"tests/c.py", "tests/b.py"})
    ) == ["pytest", "-rfE", "-x", "tests/b.py", "tests/c.py", "tests/a.py"]
    assert selected_command(SUITE, files, previous=frozenset({"tests/c.py"})) == [
        "pytest",
        "-rfE",
        "tests/c.py",
        "tests/a.py",
        "tests/b.py",
    ]


def test_a_previous_killer_outside_the_selection_is_not_added():
    assert selected_command(SUITE, {"tests/a.py"}, previous=frozenset({"tests/z.py"})) == [
        "pytest",
        "-rfE",
        "tests/a.py",
    ]


def test_the_stopping_python_whole_suite_command_adds_x_and_the_baseline_does_not():
    scoped = suite_of(command="pytest tests/unit -q")

    assert mutant_command(scoped) == "pytest tests/unit -q"
    assert mutant_command(scoped, stop=True) == "pytest tests/unit -q -x"
    assert "tests/unit" in mutant_command(scoped)


@pytest.mark.parametrize(
    ("runner_name", "flag"),
    [("vitest", "--bail=1"), ("jest", "--bail")],
)
def test_typescript_bails_with_the_suites_runner(runner_name, flag):
    suite = suite_of("typescript", runner_name)

    scoped = suite_of("typescript", runner_name, command=f"npx {runner_name} --coverage")

    assert mutant_command(scoped) == scoped.command
    assert mutant_command(scoped, stop=True) == f"{scoped.command} {flag}"
    assert selected_command(suite, None, stop=True, file="w/a.ts")[-1] == flag
    assert flag not in selected_command(suite, None, file="w/a.ts")


def test_csharp_and_rust_commands_ignore_the_stop_request():
    for language in ("csharp", "rust"):
        suite = suite_of(language)

        assert mutant_command(suite, stop=True) == mutant_command(suite)


def test_fifty_one_files_or_a_dashed_name_run_the_whole_suite():
    whole = mutant_command(SUITE)
    many = {f"tests/test_{n}.py" for n in range(51)}

    assert selected_command(SUITE, many) == whole
    assert selected_command(SUITE, set(list(many)[:50])) != whole
    assert selected_command(SUITE, {"-x.py"}) == whole


def test_a_real_python_coverage_pass_attributes_each_line_to_the_test_files_that_ran_it(
    tmp_path, monkeypatch
):
    pytest.importorskip("pytest_cov")
    root = make_repository(
        tmp_path / "r",
        {"app/shop.py": SHOP, "tests/test_a.py": TEST_A, "tests/test_b.py": TEST_B},
    )
    git_commit(root)
    work = tmp_path / "work"
    work.mkdir()
    scans = [scan for scan in read_scans(root) if scan.language == "python"]
    suites = parse_suites(
        [
            {
                "name": "api",
                "language": "python",
                "directory": ".",
                "command": f"{sys.executable} -m pytest -q -p no:cacheprovider --cov=app"
                " --cov-report=lcov:coverage/lcov.info",
                "coverage": {"path": "coverage/lcov.info", "format": "lcov"},
            }
        ]
    )

    coverage, selection = coverage_run(root, scans, suites, work)
    lines = selection["app/shop.py"]

    assert lines[7] == frozenset({"tests/test_a.py"})
    assert lines[11] == frozenset({"tests/test_b.py"})
    assert lines[15] == frozenset({"tests/test_a.py", "tests/test_b.py"})
    assert 19 not in lines
    assert coverage["app/shop.py"][19] == 0


def fake_selection(monkeypatch, selection):
    monkeypatch.setattr(
        sensor,
        "coverage_run",
        lambda repository, scans, suites, work, **_: (
            {"app/rules.py": {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 9: 1, 10: 1, 13: 0, 14: 0}},
            selection,
        ),
    )


def spy_commands(monkeypatch):
    seen = []
    real = runner.run_test_command

    def spy(command, cwd, timeout, suite=None, extra=None):
        seen.append((as_seen(command), timeout))

        return real([sys.executable, "tests/strong.py"], cwd, timeout, suite=suite)

    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)

    return seen


A = frozenset({"tests/test_a.py"})
B = frozenset({"tests/test_b.py"})
SELECTED = {"app/rules.py": {2: A, 4: A, 5: A, 6: A, 13: B}}
SELECTED_COMMAND = ["pytest", "-rfE", "tests/test_a.py"]
WHOLE_COMMAND = python_suite("tests/strong.py")["command"]
STOPPING_SELECTED = ["pytest", "-rfE", "-x", "tests/test_a.py"]
STOPPING_WHOLE = f"{WHOLE_COMMAND} -x"


def test_each_mutant_runs_the_files_that_covered_its_line_and_baselines_run_once(
    tmp_path, monkeypatch, capsys
):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    seen = spy_commands(monkeypatch)
    settings = strong_settings(incremental=False, max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    commands = [command for command, _ in seen]

    assert commands.count(SELECTED_COMMAND) == 1
    assert commands.count(STOPPING_SELECTED) == 2
    assert commands.count(WHOLE_COMMAND) == 1
    assert commands.count(STOPPING_WHOLE) == 1
    assert [timeout is None for _, timeout in seen].count(True) == 1
    assert capsys.readouterr().err.splitlines()[-1] == (
        "recognizer-sensors: mutation: 1 functions without a covering test; "
        "2 mutants ran a selection, 1 ran the whole suite"
    )


def test_a_selected_command_whose_baseline_fails_runs_its_mutants_under_the_whole_suite(
    tmp_path, monkeypatch, capsys
):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    seen = []
    real = runner.run_test_command

    def spy(command, cwd, timeout, suite=None, extra=None):
        seen.append(as_seen(command))
        failing = command == SELECTED_COMMAND and timeout is not None

        return real(
            [sys.executable, "-c", "raise SystemExit(1)" if failing else ""],
            cwd,
            timeout,
            suite=suite,
        )

    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = strong_settings(incremental=False, max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    assert (
        "the selected test command: the test suite fails before any mutation;"
        " running the whole suite"
    ) in capsys.readouterr().err
    assert seen.count(SELECTED_COMMAND) == 1
    assert seen.count(STOPPING_SELECTED) == 0
    assert seen.count(WHOLE_COMMAND) == 1
    assert seen.count(STOPPING_WHOLE) == 3


def test_a_failing_whole_suite_baseline_still_ends_the_run(tmp_path, monkeypatch, capsys):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, {})
    real = runner.run_test_command
    monkeypatch.setattr(
        sensor,
        "run_test_command",
        lambda c, cwd, t, suite=None, extra=None: real(
            [sys.executable, "-c", "exit(1)"], cwd, t, suite=suite
        ),
    )
    settings = strong_settings(incremental=False, max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2
    assert capsys.readouterr().err.strip().splitlines()[-1] == (
        "the test suite fails before any mutation"
    )


def test_the_record_key_is_the_suites_and_the_selection_marker(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    spy_commands(monkeypatch)

    assert run_mutate(root, tmp_path / "overlay.json", strong_settings()) == 0

    key = {"suites": SUITES, "selection": 3}
    expected = hashlib.sha256(
        json.dumps(key, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()

    assert read(root / RECORD)["command"] == expected


@pytest.mark.parametrize("after_first", [1000.0, 60.0])
def test_the_budget_starts_after_setup_and_reports_what_it_left_unmeasured(
    tmp_path, monkeypatch, after_first
):
    root, _ = mutate_repository(tmp_path)
    now = {"value": 0.0}
    real = sensor.run_function

    def stepping(*args, **extra):
        result = real(*args, **extra)
        now["value"] = after_first

        return result

    monkeypatch.setattr(sensor, "CLOCK", lambda: now["value"])
    monkeypatch.setattr(sensor, "run_function", stepping)

    assert (
        run_mutate(
            root,
            tmp_path / "overlay.json",
            mutate_settings("tests/strong.py", max_workers=1, max_minutes=1),
        )
        == 0
    )

    survivors = read(root / SURVIVORS)

    assert survivors["complete"] is False
    assert survivors["survivors_version"] == 1
    assert survivors["unmeasured"] == {"budget": 1, "no-covering-test": 1}
    assert len(survivors["skipped"]) == 1


def test_a_complete_run_reports_only_the_functions_without_a_covering_test(tmp_path):
    root, _ = mutate_repository(tmp_path)

    assert run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/strong.py")) == 0
    assert read(root / SURVIVORS)["unmeasured"] == {"budget": 0, "no-covering-test": 1}


def test_the_progress_total_counts_a_function_without_a_covering_test_on_every_run(
    tmp_path, monkeypatch, capsys
):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    settings = mutate_settings("tests/strong.py", max_workers=1)

    def totals():
        lines = event_lines(capsys.readouterr().err)

        return {line["total"] for line in lines if line["event"] == "progress"}

    assert run_mutate(root, output, settings) == 0

    first = totals()

    assert run_mutate(root, output, settings) == 0
    assert totals() == first == {3}


def sized_selection(*sizes):
    names = [f"tests/test_{n}.py" for n in range(4)]
    lines = [2, 4, 5, 6]

    return {
        "app/rules.py": {
            line: frozenset(names[:size]) for line, size in zip(lines, sizes, strict=False)
        }
    }


def test_a_selection_of_more_than_half_the_suite_runs_the_whole_suite_without_its_own_baseline(
    tmp_path, monkeypatch, capsys
):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, sized_selection(2, 3, 3, 4))
    seen = spy_commands(monkeypatch)
    settings = strong_settings(incremental=False, max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    commands = [as_seen_key(command) for command, _ in seen]
    half = ("pytest", "-rfE", "tests/test_0.py", "tests/test_1.py")

    stopping_half = ("pytest", "-rfE", "-x", "tests/test_0.py", "tests/test_1.py")

    assert commands.count(half) == 1
    assert commands.count(stopping_half) == 1
    assert {c for c in commands if c not in (half, stopping_half)} == {
        WHOLE_COMMAND,
        STOPPING_WHOLE,
    }
    assert (
        capsys.readouterr()
        .err.splitlines()[-1]
        .endswith("1 mutants ran a selection, 2 ran the whole suite")
    )


def test_baseline_copies_are_shared_up_to_max_workers(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    copies = []
    real = sensor.copy_repository

    def counting(source, destination):
        copies.append(destination)
        real(source, destination)

    monkeypatch.setattr(sensor, "copy_repository", counting)
    ran = []
    meeting = threading.Barrier(2, timeout=10)

    def fake_run(command, cwd, timeout, suite=None, extra=None):
        ran.append(command[-1])

        if command[-1] in "ab":
            meeting.wait()

        return runner.TestRun(0, False, 0.1, "")

    monkeypatch.setattr(sensor, "run_test_command", fake_run)
    baselines = sensor.Baselines(root, work, 2)

    with ThreadPoolExecutor(5) as pool:
        seconds = list(
            pool.map(lambda n: baselines.seconds(["x", n], "the command", SUITE), "abcdeabc")
        )

    assert seconds == [0.1] * 8
    assert len(copies) == 2
    assert sorted(ran) == list("abcde")


def test_a_failing_baseline_in_a_reused_copy_falls_back_to_the_whole_suite(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()

    def fake_run(command, cwd, timeout, suite=None, extra=None):
        return runner.TestRun(1 if command[-1] == "bad" else 0, False, 0.1, "")

    monkeypatch.setattr(sensor, "run_test_command", fake_run)
    baselines = sensor.Baselines(root, work, 1)

    assert baselines.seconds(["x", "ok"], "the command", SUITE) == 0.1
    assert baselines.seconds(["x", "bad"], "the command", SUITE, fallback=True) is None
    assert baselines.seconds(["x", "ok"], "the command", SUITE) == 0.1
    assert len(list(work.iterdir())) == 1


def test_a_selected_baseline_is_bounded_by_the_whole_suite_warm_up_and_falls_back_when_it_passes_it(
    tmp_path, monkeypatch, capsys
):
    root, _ = mutate_repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    limits = []
    fake_run = runner.run_test_command

    def slow(command, cwd, timeout, suite=None, extra=None):
        limits.append(timeout)

        return fake_run(
            [sys.executable, "-c", "import time; time.sleep(30)"], cwd, timeout, suite=suite
        )

    monkeypatch.setattr(sensor, "run_test_command", slow)
    baselines = sensor.Baselines(root, work, 1)
    whole = ["x", "whole"]
    baselines.prime(whole, SUITE, 0.1)
    limit = sensor.timeout_for(baselines.recorded(whole, SUITE), 10)
    started = time.monotonic()

    assert baselines.seconds(["x", "slow"], "the selected command", SUITE, True, limit) is None
    assert time.monotonic() - started < 25
    assert limits == [limit]
    assert limit == sensor.TIMEOUT_FLOOR
    assert "the selected command: the baseline passed its 2 second bound;" in (
        capsys.readouterr().err
    )
    assert baselines.recorded(["x", "slow"], SUITE) is None


def test_a_failed_copy_wakes_a_waiting_take_instead_of_hanging_it(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    started = threading.Event()
    calls = []

    def failing_first(source, destination):
        calls.append(destination)

        if len(calls) == 1:
            started.set()
            time.sleep(0.3)

            raise OSError("disk full")

        destination.mkdir()

    monkeypatch.setattr(sensor, "copy_repository", failing_first)
    copies = sensor.CopyPool(root, work, 1)
    outcomes = []

    def take():
        try:
            outcomes.append(copies.take())
        except OSError as error:
            outcomes.append(error)

    first = threading.Thread(target=take)
    first.start()
    started.wait(10)
    second = threading.Thread(target=take)
    second.start()
    first.join(10)
    second.join(10)

    assert not first.is_alive()
    assert not second.is_alive()
    assert sum(isinstance(outcome, OSError) for outcome in outcomes) == 1
    assert len(outcomes) == 2


def test_a_failed_copy_with_no_waiter_does_not_break_a_later_take(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    root.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    calls = []

    def failing_first(source, destination):
        calls.append(destination)

        if len(calls) == 1:
            raise OSError("disk full")

        destination.mkdir()

    monkeypatch.setattr(sensor, "copy_repository", failing_first)
    copies = sensor.CopyPool(root, work, 2)

    with pytest.raises(OSError):
        copies.take()

    first = copies.take()
    second = copies.take()

    assert first != second
    assert first.is_dir()
    assert second.is_dir()


@pytest.mark.parametrize(("runner_name", "bail"), [("jest", "--bail"), ("vitest", "--bail=1")])
def test_typescript_selected_command_caps_test_workers_only_with_several_mutation_workers(
    monkeypatch, runner_name, bail
):
    monkeypatch.setattr("os.cpu_count", lambda: 8)
    suite = suite_of("typescript", runner_name)

    def commands(workers):
        return (
            mutant_command(suite, workers=workers),
            mutant_command(suite, True, workers),
            selected_command(suite, None, workers=workers, file="w/a.ts"),
        )

    related = (
        ["vitest", "related", "w/a.ts", "--run"]
        if runner_name == "vitest"
        else ["jest", "--findRelatedTests", "w/a.ts"]
    )
    base = ["npx", "--no", "--"]

    assert commands(4) == (
        suite.command,
        f"{suite.command} {bail}",
        [*base, *related, "--maxWorkers=2"],
    )
    assert commands(1)[0] == suite.command
    assert commands(1)[2] == [*base, *related]


def test_the_typescript_worker_cap_never_falls_below_one(monkeypatch):
    monkeypatch.setattr("os.cpu_count", lambda: 2)

    assert selected_command(suite_of("typescript", "vitest"), None, workers=8, file="w/a.ts") == [
        "npx",
        "--no",
        "--",
        "vitest",
        "related",
        "w/a.ts",
        "--run",
        "--maxWorkers=1",
    ]


def test_other_languages_ignore_the_worker_count():
    for language in ("python", "rust", "csharp", "kotlin"):
        suite = suite_of(language)

        assert mutant_command(suite, workers=4) == mutant_command(suite)


def test_the_record_key_does_not_depend_on_the_mutation_worker_count(tmp_path, monkeypatch):
    real = sensor.mutant_command

    def capping(suite, stop=False, workers=1):
        command = real(suite, stop)

        return f"{command} --maxWorkers={workers}" if workers > 1 else command

    monkeypatch.setattr(sensor, "mutant_command", capping)
    fake_selection(monkeypatch, SELECTED)

    keys = []

    for workers in (1, 8):
        root, _ = mutate_repository(tmp_path / str(workers))
        seen = spy_commands(monkeypatch)
        settings = strong_settings(incremental=False, max_workers=workers)

        assert run_mutate(root, tmp_path / f"overlay-{workers}.json", settings) == 0

        keys.append(read(root / RECORD)["command"])

        if workers > 1:
            assert any("--maxWorkers=8" in command for command, _ in seen)

    assert keys[0] == keys[1]


def test_a_baseline_is_not_started_once_the_deadline_has_passed(tmp_path, monkeypatch, capsys):
    root, _ = mutate_repository(tmp_path)
    fake_selection(
        monkeypatch,
        {
            "app/rules.py": {line: A for line in (1, 2, 3, 4, 5, 6, 9, 10, 13)},
            "app/other.py": {1: B},
        },
    )
    now = {"value": 0.0}
    seen = []
    real = runner.run_test_command

    def spy(command, cwd, timeout, suite=None, extra=None):
        seen.append((as_seen(command), timeout))
        late = timeout is None and command == SELECTED_COMMAND

        if late:
            now["value"] = 1000.0

        return real(
            [sys.executable, "-c", "raise SystemExit(1)" if late else ""],
            cwd,
            timeout,
            suite=suite,
        )

    monkeypatch.setattr(sensor, "CLOCK", lambda: now["value"])
    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = strong_settings(incremental=False, max_workers=1, max_minutes=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    assert (SELECTED_COMMAND, None) in seen
    assert (WHOLE_COMMAND, None) not in seen
    assert read(root / SURVIVORS)["unmeasured"]["budget"] >= 1
    assert "uncovered-by-budget" in capsys.readouterr().err


def test_a_whole_suite_baseline_failing_after_the_deadline_keeps_the_earlier_verdicts(
    tmp_path, monkeypatch, capsys
):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    now = {"value": 0.0}
    real = runner.run_test_command
    selected_b = ["pytest", "-rfE", "tests/test_b.py"]

    def spy(command, cwd, timeout, suite=None, extra=None):
        if timeout is None and command == WHOLE_COMMAND:
            now["value"] = 1000.0

        failing = timeout is None and command in (WHOLE_COMMAND, selected_b)

        return real(
            [sys.executable, "-c", "raise SystemExit(1)" if failing else ""],
            cwd,
            timeout,
            suite=suite,
        )

    monkeypatch.setattr(sensor, "CLOCK", lambda: now["value"])
    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = strong_settings(incremental=False, max_workers=1, max_minutes=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    survivors = read(root / SURVIVORS)

    assert survivors["complete"] is False
    assert survivors["unmeasured"]["budget"] >= 1
    assert "the test suite fails before any mutation" not in capsys.readouterr().err


def prime_with(monkeypatch, filled, selection=None):
    monkeypatch.setattr(
        sensor,
        "coverage_run",
        lambda repository, scans, suites, work, seconds=None, **_: (
            seconds.update(filled) if seconds is not None else None,
            (
                {"app/rules.py": {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 9: 1, 10: 1, 13: 0, 14: 0}},
                SELECTED if selection is None else selection,
            ),
        )[1],
    )


def test_a_primed_whole_suite_baseline_does_not_run(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    prime_with(monkeypatch, {"sample": 7.0})
    seen = spy_commands(monkeypatch)
    settings = strong_settings(incremental=False, max_workers=1, timeout_factor=3)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    assert (WHOLE_COMMAND, None) not in [(c, t) for c, t in seen]
    wholes = [timeout for command, timeout in seen if command == STOPPING_WHOLE]

    assert wholes
    assert set(wholes) == {sensor.timeout_for(7.0, 3)}


def test_a_suite_without_recorded_seconds_is_baselined_lazily_once(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    prime_with(monkeypatch, {"other-suite": 7.0})
    seen = spy_commands(monkeypatch)
    settings = strong_settings(incremental=False, max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    baselines = [command for command, timeout in seen if timeout is None]

    assert baselines.count(WHOLE_COMMAND) == 1


def two_suite_repository(tmp_path):
    root, _ = mutate_repository(tmp_path)
    shutil.copytree(root / "app", root / "web" / "app")
    shutil.copytree(root / "tests", root / "web" / "tests")
    scan = root / ".recognizer" / "cache" / "scan.python.json"
    document = json.loads(scan.read_text())
    document["files"].append({"path": "web/app/rules.py", "hash": "0" * 64})
    document["modules"].append({"id": "web/app/rules.py"})
    scan.write_text(json.dumps(document))
    git_commit(root)

    return root


COVERED = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 9: 1, 10: 1, 13: 0, 14: 0}


def test_a_primed_suite_runs_no_whole_baseline_beside_an_unprimed_one(tmp_path, monkeypatch):
    root = two_suite_repository(tmp_path)
    monkeypatch.setattr(
        sensor,
        "coverage_run",
        lambda repository, scans, suites, work, seconds=None, **_: (
            seconds.update({"root": 7.0}) if seconds is not None else None,
            ({"app/rules.py": COVERED, "web/app/rules.py": COVERED}, {}),
        )[1],
    )
    seen = []
    real = runner.run_test_command

    def spy(command, cwd, timeout, suite=None, extra=None):
        seen.append((suite.name, as_seen(command), timeout))

        return real([sys.executable, "tests/strong.py"], cwd, timeout, suite=suite)

    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = json.dumps(
        {
            "tests": [
                python_suite("tests/strong.py", name="root"),
                python_suite("tests/strong.py", name="web", directory="web"),
            ],
            "incremental": False,
            "max_workers": 1,
        }
    )

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    baselines = [(name, command) for name, command, timeout in seen if timeout is None]
    mutants = {name for name, _, timeout in seen if timeout is not None}

    assert baselines.count(("root", WHOLE_COMMAND)) == 0
    assert baselines.count(("web", WHOLE_COMMAND)) == 1
    assert mutants == {"root", "web"}


def refusing_after(monkeypatch, finished):
    real = sensor.run_function
    calls = {"count": 0}
    lock = threading.Lock()

    def run(*args, **extra):
        with lock:
            calls["count"] += 1
            number = calls["count"]

        if number > finished:
            raise sensor.Refusal(sensor.mutation_tests_failed([]))

        return real(*args, **extra)

    monkeypatch.setattr(sensor, "run_function", run)


def test_a_refusal_after_mutants_ran_keeps_their_verdicts(tmp_path, monkeypatch, capsys):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    spy_commands(monkeypatch)
    refusing_after(monkeypatch, 1)
    settings = strong_settings(incremental=False, max_workers=1)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, settings) == 2

    survivors = read(root / SURVIVORS)
    findings = read(output.with_name("findings-overlay.json"))
    last = capsys.readouterr().err.strip().splitlines()[-1]

    finished = [
        name
        for name, entry in read(root / RECORD)["functions"].items()
        if any(verdict is not None for verdict in entry["verdicts"])
    ]

    assert len(finished) == 1
    assert survivors["complete"] is False
    assert survivors["unmeasured"]["budget"] >= 1
    assert len(survivors["skipped"]) == survivors["unmeasured"]["budget"]
    assert findings["diagnosis"]["line"].startswith("the run ended early: ")
    assert last == findings["diagnosis"]["line"]
    assert (root / RECORD).exists()


def test_a_refusal_before_any_function_finished_is_unchanged(tmp_path, monkeypatch, capsys):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    spy_commands(monkeypatch)
    refusing_after(monkeypatch, 0)
    settings = strong_settings(incremental=False, max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2

    assert not (root / SURVIVORS).exists()
    assert capsys.readouterr().err.strip().splitlines()[-1] == (
        "the test suite fails before any mutation"
    )


def test_a_failing_baseline_leaves_its_tail_and_the_omitted_paths(tmp_path, monkeypatch, capsys):
    root, _ = mutate_repository(tmp_path)
    (root / ".gitignore").write_text(".venv/\n")
    (root / ".venv").mkdir()
    (root / ".venv" / "x").write_text("")
    fake_selection(monkeypatch, {})
    real = runner.run_test_command
    monkeypatch.setattr(
        sensor,
        "run_test_command",
        lambda c, cwd, t, suite=None, extra=None: real(
            [sys.executable, "-c", "print('boom'); exit(1)"], cwd, t, suite=suite
        ),
    )
    settings = strong_settings(incremental=False, max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2

    log = (root / sensor.BASELINE_LOG).read_text()

    assert "boom" in log
    assert ".venv/" in log
    assert sensor.CARRY_HINT in capsys.readouterr().err

    with contextlib.suppress(Refusal):
        coverage_run(
            root,
            read_scans(root),
            parse_suites([python_suite("tests/strong.py")]),
            tmp_path / "later-work",
        )

    assert (root / sensor.BASELINE_LOG).read_text() == log


@pytest.mark.parametrize(
    ("language", "runner_name", "command", "flag"),
    [
        ("python", None, "pytest tests/unit -q", " -x"),
        ("typescript", "vitest", "npx vitest run web/unit", " --bail=1"),
        ("typescript", "jest", "npx jest web/unit", " --bail"),
        ("kotlin", None, "./gradlew :app:test --tests unit.*", " --fail-fast"),
        ("rust", None, "cargo test -p unit", ""),
        ("csharp", None, "dotnet test tests/Unit", ""),
    ],
)
def test_the_whole_suite_command_is_the_suites_own_plus_only_the_fail_fast_flag(
    language, runner_name, command, flag
):
    suite = suite_of(language, runner_name, command=command)
    stopped = mutant_command(suite, stop=True)

    assert mutant_command(suite) == command
    assert command.split()[-1] in mutant_command(suite)
    assert "pytest -rfE" not in mutant_command(suite)

    if language == "kotlin":
        assert stopped == "./gradlew :app:test --fail-fast --tests unit.*"
    else:
        assert stopped == f"{command}{flag}"


def test_a_fallback_mutant_runs_the_suites_own_command_with_the_fail_fast_flag(
    tmp_path, monkeypatch
):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, {})
    seen = spy_commands(monkeypatch)
    suite = python_suite("tests/strong.py", command="pytest tests/weak.py -q")
    settings = json.dumps({"tests": [suite], "incremental": False, "max_workers": 1})

    run_mutate(root, tmp_path / "overlay.json", settings)

    commands = [command for command, _ in seen]

    assert "pytest tests/weak.py -q -x" in commands
    assert "pytest -rfE -x" not in commands


def test_a_primed_key_is_one_element_for_a_command_with_spaces(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    prime_with(monkeypatch, {"sample": 7.0})
    seen = spy_commands(monkeypatch)
    settings = strong_settings(incremental=False, max_workers=1, timeout_factor=3)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    assert sensor.baseline_key(SUITE, "pytest a b") == ("api", "pytest a b")
    assert sensor.baseline_key(SUITE, ["pytest", "a"]) == ("api", "pytest", "a")
    assert not [c for c, t in seen if t is None and c == WHOLE_COMMAND]


def sleeper(pid_file):
    return [
        sys.executable,
        "-c",
        "import os, time; "
        f"temporary = {str(pid_file)!r} + '.' + str(os.getpid()) + '.tmp'; "
        "open(temporary, 'w').write(str(os.getpid())); "
        f"os.replace(temporary, {str(pid_file)!r}); "
        "time.sleep(120)",
    ]


def pass_the_deadline_once_running(pid_file, now):
    def wait():
        deadline = time.monotonic() + 30

        while not pid_file.exists() and time.monotonic() < deadline:
            time.sleep(0.02)

        now["value"] = 1000.0

    threading.Thread(target=wait, daemon=True).start()


def process_is_gone(pid_file):
    pid = wait_for_pid(pid_file, time.monotonic() + 30)
    deadline = time.monotonic() + 30

    while time.monotonic() < deadline:
        state = subprocess.run(
            ["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True
        ).stdout.strip()

        if not state or state.startswith("Z"):
            return True

        time.sleep(0.05)

    return False


def test_a_baseline_running_at_the_deadline_is_ended_and_its_function_is_uncovered_by_budget(
    tmp_path, monkeypatch
):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    now = {"value": 0.0}
    pid_file = tmp_path / "baseline.pid"
    real = runner.run_test_command
    started = {}

    def spy(command, cwd, timeout, suite=None, extra=None):
        if timeout is not None:
            return real([sys.executable, "-c", ""], cwd, timeout, suite=suite)

        started.setdefault("at", time.monotonic())
        pass_the_deadline_once_running(pid_file, now)

        return real(sleeper(pid_file), cwd, timeout, suite=suite)

    monkeypatch.setattr(sensor, "CLOCK", lambda: now["value"])
    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = strong_settings(incremental=False, max_workers=1, max_minutes=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    assert time.monotonic() - started["at"] < 30
    assert process_is_gone(pid_file)
    survivors = read(root / SURVIVORS)

    assert survivors["complete"] is False
    assert survivors["unmeasured"]["budget"] >= 1


def test_a_mutant_running_at_the_deadline_is_ended_and_gives_no_verdict(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    now = {"value": 0.0}
    pid_file = tmp_path / "mutant.pid"
    real = runner.run_test_command
    started = {}

    def spy(command, cwd, timeout, suite=None, extra=None):
        if timeout is None:
            return real([sys.executable, "-c", ""], cwd, timeout, suite=suite)

        started.setdefault("at", time.monotonic())
        pass_the_deadline_once_running(pid_file, now)

        return real(sleeper(pid_file), cwd, timeout, suite=suite)

    monkeypatch.setattr(sensor, "CLOCK", lambda: now["value"])
    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = strong_settings(incremental=False, max_workers=1, max_minutes=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    assert time.monotonic() - started["at"] < 30
    assert process_is_gone(pid_file)
    survivors = read(root / SURVIVORS)

    assert survivors["complete"] is False
    assert survivors["unmeasured"]["budget"] >= 1
    assert not survivors.get("timeouts")


def test_python_node_selection_is_pytest_on_the_node_ids():
    nodes = {"tests/b.py::t2", "tests/a.py::t1[x|y]"}
    files = {"tests/a.py", "tests/b.py"}

    assert selected_command(SUITE, files, nodes=nodes) == [
        "pytest",
        "-rfE",
        "tests/a.py::t1[x|y]",
        "tests/b.py::t2",
    ]
    assert selected_command(SUITE, files, stop=True, nodes=nodes)[:3] == ["pytest", "-rfE", "-x"]


def test_a_previous_killer_file_leads_the_node_selection():
    nodes = {"tests/a.py::t1", "tests/b.py::t2"}

    assert selected_command(
        SUITE, {"tests/a.py", "tests/b.py"}, previous=frozenset({"tests/b.py"}), nodes=nodes
    ) == ["pytest", "-rfE", "tests/b.py::t2", "tests/a.py::t1"]


def test_node_selection_falls_back_to_files_past_the_node_cap_and_for_a_dashed_id():
    files = {"tests/a.py"}
    at_cap = {f"tests/a.py::t{n}" for n in range(MAX_SELECTED_NODES)}
    over = {f"tests/a.py::t{n}" for n in range(MAX_SELECTED_NODES + 1)}
    file_command = ["pytest", "-rfE", "tests/a.py"]

    assert selected_command(SUITE, files, nodes=at_cap)[2:] == sorted(at_cap)
    assert selected_command(SUITE, files, nodes=over) == file_command
    assert selected_command(SUITE, files, nodes={"-x::t"}) == file_command


def test_a_node_selection_spanning_fifty_one_files_selects_nodes():
    nodes = {f"tests/test_{n}.py::t" for n in range(51)}
    files = {f"tests/test_{n}.py" for n in range(51)}

    assert selected_command(SUITE, files, nodes=nodes)[2:] == sorted(nodes)
    assert selected_command(SUITE, files) == mutant_command(SUITE)


def test_node_selection_names_ids_relative_to_the_suite_directory():
    nested = suite_of(directory="service")

    assert selected_command(nested, {"service/tests/a.py"}, nodes={"service/tests/a.py::t"}) == [
        "pytest",
        "-rfE",
        "tests/a.py::t",
    ]
    assert selected_command(
        nested, {"other/tests/a.py"}, nodes={"other/tests/a.py::t"}
    ) == mutant_command(nested)


class NodeSelection(dict):
    def __init__(self, files, nodes):
        super().__init__(files)
        self.node_lines = nodes

    def nodes(self, path):
        return self.node_lines.get(path, {})


def test_a_mutant_runs_the_node_ids_that_covered_its_line(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    nodes = {"app/rules.py": {2: frozenset({"tests/test_a.py::t1"})}}
    fake_selection(monkeypatch, NodeSelection(SELECTED, nodes))
    seen = spy_commands(monkeypatch)
    settings = strong_settings(incremental=False, max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    commands = [command for command, _ in seen]

    assert ["pytest", "-rfE", "tests/test_a.py::t1"] in commands
    assert ["pytest", "-rfE", "-x", "tests/test_a.py::t1"] in commands


def test_nodes_naming_other_files_than_the_selection_keep_file_selection():
    assert sensor.node_set_for(frozenset({"tests/b.py::t"}), frozenset({"tests/a.py"})) is None
    assert sensor.node_set_for(None, frozenset({"tests/a.py"})) is None
    assert sensor.node_set_for(
        frozenset({"tests/a.py::t"}), frozenset({"tests/a.py"})
    ) == frozenset({"tests/a.py::t"})


def test_a_node_selection_leaves_the_record_the_file_selection_writes(tmp_path, monkeypatch):
    records = []
    nodes = {"app/rules.py": {2: frozenset({"tests/test_a.py::t1"})}}

    for name, selection in (
        ("files", SELECTED),
        ("nodes", NodeSelection(SELECTED, nodes)),
    ):
        base = tmp_path / name
        base.mkdir()
        root, _ = mutate_repository(base)
        fake_selection(monkeypatch, selection)
        settings = strong_settings(incremental=False, max_workers=1)

        assert run_mutate(root, base / "overlay.json", settings) == 0

        record = json.loads((root / RECORD).read_text())
        records.append({k: v for k, v in record.items() if k != "commit"})

    assert len(records[0]["functions"]) > 0
    assert records[0] == records[1]
