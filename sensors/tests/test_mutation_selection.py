import hashlib
import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import make_repository, mutate_repository, mutate_settings
from test_mutation import COVERAGE, RECORD, SURVIVORS, read, run_mutate

from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.scans import read_scans
from recognizer_sensors.testrun import profiles
from recognizer_sensors.testrun.profiles import mutant_command, selected_command
from recognizer_sensors.testrun.run import (
    collect_coverage_with_tests,
    python_selection,
    read_contexts,
)

TS_LCOV = ".recognizer/cache/coverage/typescript/lcov.info"

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


def contexts_document(lines):
    return json.dumps({"files": {"app/m.py": {"contexts": lines}}})


def test_the_context_reader_keeps_only_lines_whose_every_context_is_an_existing_file(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_a.py").write_text("")
    (tmp_path / "tests" / "test_b.py").write_text("")
    document = contexts_document(
        {
            "1": ["tests/test_a.py"],
            "2": ["tests/test_a.py", "tests/test_b.py"],
            "3": [""],
            "4": ["test_a.test_one"],
            "5": ["tests/missing.py"],
            "6": ["tests/test_a.py", ""],
        }
    )

    assert read_contexts(document, tmp_path) == {
        "app/m.py": {
            1: frozenset({"tests/test_a.py"}),
            2: frozenset({"tests/test_a.py", "tests/test_b.py"}),
        }
    }


def test_a_context_named_by_node_id_is_read_into_the_selection_intact(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_a.py").write_text("")
    parametrised = "tests/test_a.py::TestA::test_one[1-a b]"
    document = contexts_document(
        {
            "1": [parametrised],
            "2": ["tests/test_a.py::test_two", parametrised],
            "3": ["tests/missing.py::test_one"],
        }
    )

    assert read_contexts(document, tmp_path) == {
        "app/m.py": {
            1: frozenset({parametrised}),
            2: frozenset({"tests/test_a.py::test_two", parametrised}),
        }
    }

    assert selected_command(tmp_path, "python", {parametrised})[-1] == parametrised


def test_a_python_selection_falls_back_to_files_then_to_the_whole_suite(tmp_path):
    ids = {f"t/test_{n}.py::test_a{m}" for n in range(3) for m in range(40)}
    command = selected_command(tmp_path, "python", ids)

    assert command[-3:] == ["t/test_0.py", "t/test_1.py", "t/test_2.py"]

    wide = {f"t/test_{n}.py::test_a" for n in range(profiles.MAX_SELECTED_FILES + 1)}

    assert selected_command(tmp_path, "python", wide) == mutant_command(tmp_path, "python")


def test_killers_are_ordered_first_by_their_file(tmp_path):
    ids = {"t/test_a.py::test_x", "t/test_b.py::test_y"}
    command = selected_command(tmp_path, "python", ids, True, frozenset({"t/test_b.py"}))

    assert command[-2:] == ["t/test_b.py::test_y", "t/test_a.py::test_x"]


@pytest.mark.parametrize("text", ["not json", "[]", '{"files": []}', '{"files": {"a": 1}}'])
def test_an_unreadable_context_document_selects_nothing(tmp_path, text):
    assert read_contexts(text, tmp_path) == {}


def test_a_missing_context_file_selects_nothing(tmp_path):
    assert python_selection(tmp_path) == {}


@pytest.mark.parametrize(
    ("lockfile", "runner_words"),
    [("uv.lock", ["uv", "run"]), ("poetry.lock", ["poetry", "run"]), (None, ["python3", "-m"])],
)
def test_python_selection_follows_the_runner(tmp_path, lockfile, runner_words):
    if lockfile:
        (tmp_path / lockfile).write_text("")

    assert selected_command(tmp_path, "python", {"tests/b.py", "tests/a.py"}) == [
        *runner_words,
        "pytest",
        "-rfE",
        "tests/a.py",
        "tests/b.py",
    ]


def test_typescript_selection_passes_the_files_after_a_separator(tmp_path):
    assert selected_command(tmp_path, "typescript", {"web/a.test.ts"}) == [
        "npm",
        "test",
        "--",
        "web/a.test.ts",
    ]


def test_a_previous_killer_file_leads_the_python_selected_command(tmp_path):
    files = {"tests/a.py", "tests/b.py", "tests/c.py"}

    assert selected_command(
        tmp_path, "python", files, stop=True, previous=frozenset({"tests/c.py", "tests/b.py"})
    ) == ["python3", "-m", "pytest", "-rfE", "-x", "tests/b.py", "tests/c.py", "tests/a.py"]
    assert selected_command(tmp_path, "python", files, previous=frozenset({"tests/c.py"})) == [
        "python3",
        "-m",
        "pytest",
        "-rfE",
        "tests/c.py",
        "tests/a.py",
        "tests/b.py",
    ]


def test_a_previous_killer_outside_the_selection_is_not_added(tmp_path):
    assert selected_command(
        tmp_path, "python", {"tests/a.py"}, previous=frozenset({"tests/z.py"})
    ) == ["python3", "-m", "pytest", "-rfE", "tests/a.py"]


def test_the_stopping_python_whole_suite_command_adds_x_and_the_baseline_does_not(tmp_path):
    assert mutant_command(tmp_path, "python") == ["python3", "-m", "pytest", "-rfE"]
    assert mutant_command(tmp_path, "python", stop=True) == [
        "python3",
        "-m",
        "pytest",
        "-rfE",
        "-x",
    ]


@pytest.mark.parametrize(
    ("script", "bails"),
    [
        ("jest", True),
        ("vitest run", True),
        ("jest --ci", True),
        ("npm run unit", False),
        ("node --test", False),
        ("cross-env CI=1 vitest", False),
        ("", False),
    ],
)
def test_typescript_bails_only_when_the_test_script_starts_with_jest_or_vitest(
    tmp_path, script, bails
):
    (tmp_path / "package.json").write_text(json.dumps({"scripts": {"test": script}}))

    whole = mutant_command(tmp_path, "typescript", stop=True)
    chosen = selected_command(
        tmp_path,
        "typescript",
        {"w/a.test.ts", "w/b.test.ts"},
        stop=True,
        previous=frozenset({"w/b.test.ts"}),
    )

    assert whole == (["npm", "test", "--", "--bail=1"] if bails else ["npm", "test"])
    assert chosen == [
        "npm",
        "test",
        "--",
        *(["--bail=1"] if bails else []),
        "w/b.test.ts",
        "w/a.test.ts",
    ]
    assert mutant_command(tmp_path, "typescript") == ["npm", "test"]


def test_typescript_without_a_readable_package_json_keeps_the_plain_command(tmp_path):
    assert mutant_command(tmp_path, "typescript", stop=True) == ["npm", "test"]

    (tmp_path / "package.json").write_text("not json")

    assert mutant_command(tmp_path, "typescript", stop=True) == ["npm", "test"]


def test_csharp_and_rust_commands_ignore_the_stop_request(tmp_path):
    for language in ("csharp", "rust"):
        assert mutant_command(tmp_path, language, stop=True) == mutant_command(tmp_path, language)


def test_fifty_one_files_or_a_dashed_name_run_the_whole_suite(tmp_path):
    whole = mutant_command(tmp_path, "python")
    many = {f"tests/test_{n}.py" for n in range(51)}

    assert selected_command(tmp_path, "python", many) == whole
    assert selected_command(tmp_path, "python", set(list(many)[:50])) != whole
    assert selected_command(tmp_path, "python", {"-x.py"}) == whole


def test_a_real_python_coverage_pass_attributes_each_line_to_the_test_files_that_ran_it(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(profiles, "python_runner", lambda repository: [sys.executable, "-m"])
    root = make_repository(
        tmp_path / "r",
        {"app/shop.py": SHOP, "tests/test_a.py": TEST_A, "tests/test_b.py": TEST_B},
    )
    scans = [scan for scan in read_scans(root) if scan.language == "python"]

    coverage, selection = collect_coverage_with_tests(root, scans, None)
    lines = selection["app/shop.py"]

    assert lines[7] == frozenset({"tests/test_a.py::test_clamp"})
    assert lines[11] == frozenset({"tests/test_b.py::test_total"})
    assert lines[15] == frozenset({"tests/test_a.py::test_shared", "tests/test_b.py::test_shared"})
    assert 1 not in lines
    assert 3 not in lines
    assert 6 not in lines
    assert 19 not in lines
    assert coverage["app/shop.py"][19] == 0


def fake_selection(monkeypatch, selection):
    monkeypatch.setattr(
        sensor,
        "collect_coverage_with_tests",
        lambda repository, scans, coverage: (
            {"app/rules.py": {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 9: 1, 10: 1, 13: 0, 14: 0}},
            selection,
        ),
    )


def spy_commands(monkeypatch):
    seen = []
    real = runner.run_test_command

    def spy(command, cwd, timeout):
        seen.append((list(command), timeout))

        return real([sys.executable, "tests/strong.py"], cwd, timeout)

    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)

    return seen


A = frozenset({"tests/test_a.py"})
B = frozenset({"tests/test_b.py"})
SELECTED = {"app/rules.py": {2: A, 4: A, 5: A, 6: A, 13: B}}
SELECTED_COMMAND = ["python3", "-m", "pytest", "-rfE", "tests/test_a.py"]
WHOLE_COMMAND = ["python3", "-m", "pytest", "-rfE"]
STOPPING_SELECTED = ["python3", "-m", "pytest", "-rfE", "-x", "tests/test_a.py"]
STOPPING_WHOLE = ["python3", "-m", "pytest", "-rfE", "-x"]


def test_each_mutant_runs_the_files_that_covered_its_line_and_baselines_run_once(
    tmp_path, monkeypatch, capsys
):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    seen = spy_commands(monkeypatch)
    settings = json.dumps({"incremental": False, "max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    commands = [command for command, _ in seen]

    assert commands.count(SELECTED_COMMAND) == 1
    assert commands.count(STOPPING_SELECTED) == 2
    assert commands.count(WHOLE_COMMAND) == 1
    assert commands.count(STOPPING_WHOLE) == 1
    assert [timeout is None for _, timeout in seen].count(True) == 2
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

    def spy(command, cwd, timeout):
        seen.append(list(command))
        failing = command == SELECTED_COMMAND and timeout is None

        return real([sys.executable, "-c", "raise SystemExit(1)" if failing else ""], cwd, timeout)

    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = json.dumps({"incremental": False, "max_workers": 1})

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
        lambda c, cwd, t: real([sys.executable, "-c", "exit(1)"], cwd, t),
    )
    settings = json.dumps({"incremental": False, "max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2
    assert capsys.readouterr().err.strip().splitlines()[-1] == (
        "the test suite fails before any mutation"
    )


def test_a_configured_command_replaces_selection_and_keeps_its_record_key(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    seen = spy_commands(monkeypatch)
    configured = [sys.executable, "tests/strong.py"]

    assert run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/strong.py")) == 0

    assert {tuple(command) for command, _ in seen} == {tuple(configured)}

    expected = hashlib.sha256(json.dumps(configured, separators=(",", ":")).encode()).hexdigest()

    assert read(root / RECORD)["command"] == expected


def test_the_record_key_without_a_configured_command_carries_the_selection_marker(
    tmp_path, monkeypatch
):
    root, _ = mutate_repository(tmp_path)
    fake_selection(monkeypatch, SELECTED)
    spy_commands(monkeypatch)

    assert run_mutate(root, tmp_path / "overlay.json", json.dumps({})) == 0

    key = {"commands": {"python": WHOLE_COMMAND}, "selection": 2}
    expected = hashlib.sha256(
        json.dumps(key, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()

    assert read(root / RECORD)["command"] == expected


def test_a_coverage_setting_runs_the_whole_suite_for_every_mutant(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    seen = spy_commands(monkeypatch)
    settings = json.dumps({"coverage": COVERAGE, "incremental": False, "max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert {tuple(command) for command, _ in seen} == {
        tuple(WHOLE_COMMAND),
        tuple(STOPPING_WHOLE),
    }


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

    monkeypatch.setenv("RECOGNIZER_PROGRESS", "1")

    def totals():
        lines = [
            json.loads(line.removeprefix("recognizer-progress "))
            for line in capsys.readouterr().err.splitlines()
            if line.startswith("recognizer-progress ")
        ]

        return {line["total"] for line in lines if line["step"] == "mutants"}

    assert run_mutate(root, output, settings) == 0

    first = totals()

    assert run_mutate(root, output, settings) == 0
    assert totals() == first == {3}


def typescript_repository(tmp_path):
    root = make_repository(
        tmp_path / "r",
        {
            "web/lib.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
            "web/a.test.ts": "",
            "web/b.test.ts": "",
        },
    )

    return root


def fake_c8(root, failing=None):
    def fake(command, **kwargs):
        if command[0] != "npx":
            raise AssertionError(command)

        directory = command[command.index("--reports-dir") + 1]
        by_file = command[-1] if "--" in command else None
        number = directory.rsplit("/", 1)[-1]
        body = {
            None: "SF:web/lib.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n",
            "0": "SF:web/lib.ts\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n",
            "1": "SF:web/lib.ts\nDA:1,1\nDA:2,0\nDA:3,1\nend_of_record\n",
        }[number if by_file else None]
        (root / directory).mkdir(parents=True, exist_ok=True)
        (root / directory / "lcov.info").write_text(body)
        code = 1 if failing is not None and by_file == failing else 0

        return subprocess.CompletedProcess(command, code)

    return fake


def test_typescript_runs_one_coverage_pass_per_test_file_and_reads_each_report(
    tmp_path, monkeypatch
):
    root = typescript_repository(tmp_path)
    monkeypatch.setattr("recognizer_sensors.testrun.run.subprocess.run", fake_c8(root))

    _, selection = collect_coverage_with_tests(root, read_scans(root), None)

    assert selection == {
        "web/lib.ts": {
            1: frozenset({"web/a.test.ts", "web/b.test.ts"}),
            2: frozenset({"web/a.test.ts"}),
            3: frozenset({"web/b.test.ts"}),
        }
    }


def test_one_failing_per_file_run_drops_typescript_selection_for_the_run(
    tmp_path, monkeypatch, capsys
):
    root = typescript_repository(tmp_path)
    monkeypatch.setattr(
        "recognizer_sensors.testrun.run.subprocess.run", fake_c8(root, failing="web/b.test.ts")
    )

    coverage, selection = collect_coverage_with_tests(root, read_scans(root), None)

    assert selection == {}
    assert coverage == {"web/lib.ts": {1: 1, 2: 1, 3: 1}}
    assert "running the whole suite for typescript" in capsys.readouterr().err


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
    settings = json.dumps({"incremental": False, "max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    commands = [tuple(command) for command, _ in seen]
    half = ("python3", "-m", "pytest", "-rfE", "tests/test_0.py", "tests/test_1.py")

    stopping_half = ("python3", "-m", "pytest", "-rfE", "-x", "tests/test_0.py", "tests/test_1.py")

    assert commands.count(half) == 1
    assert commands.count(stopping_half) == 1
    assert {c for c in commands if c not in (half, stopping_half)} == {
        tuple(WHOLE_COMMAND),
        tuple(STOPPING_WHOLE),
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

    def fake_run(command, cwd, timeout):
        ran.append(command[-1])

        if command[-1] in "ab":
            meeting.wait()

        return runner.TestRun(0, False, 0.1, "")

    monkeypatch.setattr(sensor, "run_test_command", fake_run)
    baselines = sensor.Baselines(root, work, 2)

    with ThreadPoolExecutor(5) as pool:
        seconds = list(pool.map(lambda n: baselines.seconds(["x", n], "the command"), "abcdeabc"))

    assert seconds == [0.1] * 8
    assert len(copies) == 2
    assert sorted(ran) == list("abcde")


def test_a_failing_baseline_in_a_reused_copy_falls_back_to_the_whole_suite(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    work = tmp_path / "work"
    work.mkdir()

    def fake_run(command, cwd, timeout):
        return runner.TestRun(1 if command[-1] == "bad" else 0, False, 0.1, "")

    monkeypatch.setattr(sensor, "run_test_command", fake_run)
    baselines = sensor.Baselines(root, work, 1)

    assert baselines.seconds(["x", "ok"], "the command") == 0.1
    assert baselines.seconds(["x", "bad"], "the command", fallback=True) is None
    assert baselines.seconds(["x", "ok"], "the command") == 0.1
    assert len(list(work.iterdir())) == 1


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


def test_typescript_test_files_select_every_script_form():
    from recognizer_sensors.scans import Scan, ScanModule
    from recognizer_sensors.testrun.run import typescript_test_files

    scan = Scan(
        language="typescript",
        modules=(
            ScanModule(id="a", files=("src/a.test.mts", "src/c.test.ts", "src/a.ts")),
            ScanModule(id="b", files=("src/b.spec.cjs", "src/b.test.d.mts")),
        ),
        modified=False,
    )

    assert sorted(set(typescript_test_files(scan))) == [
        "src/a.test.mts",
        "src/b.spec.cjs",
        "src/c.test.ts",
    ]


@pytest.mark.parametrize(
    ("script", "capped"), [("jest", True), ("vitest run", True), ("node --test", False)]
)
def test_typescript_commands_cap_test_workers_only_with_several_mutation_workers(
    tmp_path, monkeypatch, script, capped
):
    monkeypatch.setattr("os.cpu_count", lambda: 8)
    (tmp_path / "package.json").write_text(json.dumps({"scripts": {"test": script}}))
    files = {"w/a.test.ts"}

    def commands(workers):
        return (
            mutant_command(tmp_path, "typescript", workers=workers),
            mutant_command(tmp_path, "typescript", True, workers),
            selected_command(tmp_path, "typescript", files, workers=workers),
        )

    cap = ["--maxWorkers=2"] if capped else []
    bail = ["--bail=1"] if capped else []

    assert commands(4) == (
        ["npm", "test", *(["--", *cap] if capped else [])],
        ["npm", "test", *(["--", *bail, *cap] if capped else [])],
        ["npm", "test", "--", *cap, "w/a.test.ts"],
    )
    assert commands(1)[0] == ["npm", "test"]
    assert commands(1)[2] == ["npm", "test", "--", "w/a.test.ts"]


def test_the_typescript_worker_cap_never_falls_below_one(tmp_path, monkeypatch):
    monkeypatch.setattr("os.cpu_count", lambda: 2)
    (tmp_path / "package.json").write_text(json.dumps({"scripts": {"test": "vitest"}}))

    assert mutant_command(tmp_path, "typescript", workers=8) == [
        "npm",
        "test",
        "--",
        "--maxWorkers=1",
    ]


def test_other_languages_ignore_the_worker_count(tmp_path):
    for language in ("python", "rust", "csharp", "kotlin"):
        assert mutant_command(tmp_path, language, workers=4) == mutant_command(tmp_path, language)


def test_the_record_key_does_not_depend_on_the_mutation_worker_count(tmp_path, monkeypatch):
    real = sensor.mutant_command

    def capping(repository, language, stop=False, workers=1):
        command = real(repository, language, stop)

        return [*command, f"--maxWorkers={workers}"] if workers > 1 else command

    monkeypatch.setattr(sensor, "mutant_command", capping)
    fake_selection(monkeypatch, SELECTED)

    keys = []

    for workers in (1, 8):
        root, _ = mutate_repository(tmp_path / str(workers))
        seen = spy_commands(monkeypatch)
        settings = json.dumps({"incremental": False, "max_workers": workers})

        assert run_mutate(root, tmp_path / f"overlay-{workers}.json", settings) == 0

        keys.append(read(root / RECORD)["command"])

        if workers > 1:
            assert any("--maxWorkers=8" in command for command, _ in seen)

    assert keys[0] == keys[1]
