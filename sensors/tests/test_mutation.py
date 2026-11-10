import errno
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time

import pytest
from conftest import (
    FINDINGS_SCHEMA,
    OVERLAY_SCHEMA,
    SENSOR_LIST,
    STOP_FIXTURE,
    mutate_repository,
    mutate_settings,
)
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.mutation.record import resolve_set_list, resolve_site
from recognizer_sensors.mutation.runner import new_work_folder, remove_stale_work_folders
from recognizer_sensors.settings import SettingsError

SURVIVORS = ".recognizer/cache/mutation/survivors.json"
COVERAGE = "coverage/lcov.info"
OVERLAY = ".recognizer/cache/overlays/mutation.json"


def run_mutate(root, output, settings, *extra):
    findings = output.with_name("findings-" + output.name)
    code = main(
        [
            "mutation",
            "--repository",
            str(root),
            "--output",
            str(findings),
            "--settings",
            settings,
            *extra,
        ]
    )
    overlay = root / OVERLAY

    if code == 0 and overlay.exists():
        output.write_text(overlay.read_text())

    return code


def read_resolved(path):
    document = json.loads(path.read_text())
    sets = resolve_set_list(document)

    for entry in document["functions"].values():
        entry["sites"] = [resolve_site(site, sets) for site in entry["sites"]]

    return document


def read(path):
    return json.loads(path.read_text())


def row(overlay, identity):
    values = overlay["values"]

    return [values[name].get(identity) for name in ("killed", "survived", "uncovered", "score")]


def snapshot(root):
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file()
        and ".git" not in p.relative_to(root).parts
        and ".recognizer/cache/" not in p.relative_to(root).as_posix()
    }


def test_weak_tests_leave_the_table_s_survivors(tmp_path):
    root, commit = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 0

    overlay = read(output)

    Draft202012Validator(read(OVERLAY_SCHEMA)).validate(overlay)
    assert overlay["commit"] == commit
    assert overlay["modified"] is False
    assert overlay["producer"]["name"] == "mutation"
    assert row(overlay, "app/rules.py::grade") == [0, 2, 0, 0.0]
    assert row(overlay, "app/rules.py::both") == [0, 1, 0, 0.0]
    assert row(overlay, "app/rules.py::total") == [0, 0, 1, None]

    survivors = read(root / SURVIVORS)

    assert survivors["commit"] == commit
    assert list(survivors["functions"]) == ["app/rules.py::both", "app/rules.py::grade"]
    assert survivors["functions"]["app/rules.py::grade"] == {
        "module": "app/rules.py",
        "name": "grade",
        "file": "app/rules.py",
        "lines": [1, 6],
        "survivors": [
            {"line": 2, "operator": ">=", "replacement": ">"},
            {"line": 4, "operator": ">=", "replacement": ">"},
        ],
        "timeouts": [],
    }
    assert survivors["functions"]["app/rules.py::both"]["survivors"] == [
        {"line": 10, "operator": "and", "replacement": "or"}
    ]


def test_strong_tests_kill_every_covered_mutant(tmp_path):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/strong.py")) == 0

    overlay = read(output)

    assert row(overlay, "app/rules.py::grade") == [2, 0, 0, 1.0]
    assert row(overlay, "app/rules.py::both") == [1, 0, 0, 1.0]
    assert row(overlay, "app/rules.py::total") == [0, 0, 1, None]
    assert read(root / SURVIVORS)["functions"] == {}


def test_a_hung_mutant_times_out_and_is_killed(tmp_path):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    started = time.monotonic()

    assert run_mutate(root, output, mutate_settings("tests/slow_on_mutant.py")) == 0

    overlay = read(output)

    assert time.monotonic() - started < 30
    assert row(overlay, "app/rules.py::grade") == [1, 1, 0, 0.5]
    assert row(overlay, "app/rules.py::both") == [0, 1, 0, 0.0]
    assert row(overlay, "app/rules.py::total") == [0, 0, 1, None]


def test_the_output_does_not_depend_on_max_workers(tmp_path):
    root, _ = mutate_repository(tmp_path)
    first, second = tmp_path / "one.json", tmp_path / "four.json"

    assert (
        run_mutate(root, first, mutate_settings("tests/weak.py", max_workers=1, incremental=False))
        == 0
    )

    one_survivors = (root / SURVIVORS).read_bytes()

    assert (
        run_mutate(root, second, mutate_settings("tests/weak.py", max_workers=4, incremental=False))
        == 0
    )
    assert first.read_bytes() == second.read_bytes()
    assert one_survivors == (root / SURVIVORS).read_bytes()


@pytest.mark.parametrize(("workers", "overlapped"), [(1, False), (2, True)])
def test_max_workers_mutants_run_at_once(tmp_path, monkeypatch, workers, overlapped):
    root, _ = mutate_repository(tmp_path)
    rendezvous = tmp_path / "rendezvous"
    rendezvous.mkdir()
    monkeypatch.setenv("RENDEZVOUS_DIR", str(rendezvous))

    assert (
        run_mutate(
            root,
            tmp_path / "overlay.json",
            mutate_settings("tests/rendezvous.py", max_workers=workers),
        )
        == 0
    )
    assert (rendezvous / "overlapped").exists() is overlapped


def test_the_real_tree_is_unchanged_and_no_copy_is_left(tmp_path):
    root, _ = mutate_repository(tmp_path)
    before = snapshot(root)

    assert run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/weak.py")) == 0
    assert snapshot(root) == before
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()


def stale_folder(work, name, pid):
    folder = work.parent / name
    folder.mkdir()
    (folder / "copy.txt").write_text("x")

    if pid is not None:
        (folder / "pid").write_text(str(pid))

    return folder


def dead_pid():
    import subprocess

    process = subprocess.Popen(["true"])
    process.wait()

    return process.pid


def test_a_work_folder_whose_process_is_dead_is_removed(tmp_path):
    work = new_work_folder(tmp_path)
    stale = stale_folder(work, "dead", dead_pid())

    remove_stale_work_folders(work)

    assert not stale.exists()
    assert work.exists()


def test_a_work_folder_whose_process_is_alive_is_kept(tmp_path):
    work = new_work_folder(tmp_path)
    live = stale_folder(work, "live", os.getpid())

    remove_stale_work_folders(work)

    assert live.exists()


def test_an_old_work_folder_without_a_pid_file_is_removed(tmp_path):
    work = new_work_folder(tmp_path)
    stale = stale_folder(work, "nopid", None)
    old = time.time() - 120
    os.utime(stale, (old, old))

    remove_stale_work_folders(work)

    assert not stale.exists()


def test_a_fresh_work_folder_without_a_pid_file_is_kept(tmp_path):
    work = new_work_folder(tmp_path)
    fresh = stale_folder(work, "nopid", None)

    remove_stale_work_folders(work)

    assert fresh.exists()


def test_a_run_removes_the_folders_a_killed_run_left(tmp_path):
    root, _ = mutate_repository(tmp_path)
    work = new_work_folder(root)
    stale = stale_folder(work, "dead", dead_pid())
    live = work.parent / "keep-parent"
    live.mkdir()
    (live / "pid").write_text(str(os.getpid()))

    assert run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/weak.py")) == 0
    assert not stale.exists()
    assert live.exists()


@pytest.mark.parametrize(
    "command", [["python3", "-c", "raise SystemExit(1)"], ["/no/such/program"]]
)
def test_a_failing_or_unstartable_baseline_is_exit_two_and_writes_nothing(
    tmp_path, capsys, command
):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    settings = json.dumps({"test_command": command, "coverage": COVERAGE})

    assert run_mutate(root, output, settings) == 2
    assert capsys.readouterr().err.strip().splitlines()[-1] in {
        "the test suite fails before any mutation",
        "/no/such/program is not installed",
    }
    assert not output.exists()
    assert not (root / SURVIVORS).exists()
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()


def test_a_failing_baseline_names_the_failing_tests_in_both_stderr_lines(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    script = (
        "import sys; print('FAILED tests/test_a.py::test_x - assert 1 == 2');"
        "print('=== 1 failed, 4 passed in 0.31s ==='); sys.exit(2)"
    )
    settings = json.dumps({"test_command": ["python3", "-c", script], "coverage": COVERAGE})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2
    lines = capsys.readouterr().err.splitlines()
    reason = json.loads(lines[0].removeprefix("recognizer-reason "))

    assert len(lines) == 2
    assert reason["code"] == "tests-failed"
    assert reason["failing"] == {"count": 1, "names": ["tests/test_a.py::test_x"]}
    assert lines[1] == "the test suite fails before any mutation: tests/test_a.py::test_x"
    assert reason["line"] == lines[1]


def test_the_baseline_failure_is_one_sentence_and_the_tail_goes_to_the_log(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    script = "import sys; print('\\n'.join(str(i) for i in range(40))); sys.exit(3)"
    settings = json.dumps({"test_command": ["python3", "-c", script], "coverage": COVERAGE})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2
    assert capsys.readouterr().err.splitlines()[-1] == "the test suite fails before any mutation"

    log = (root / ".recognizer" / "cache" / "coverage" / "last-run.log").read_text()

    assert "39" in log
    assert "\n19\n" not in log


def test_a_missing_coverage_file_is_exit_two_with_one_sentence(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    (root / "coverage" / "lcov.info").unlink()
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 2
    assert capsys.readouterr().err == f"the coverage file is missing: {COVERAGE}\n"
    assert not output.exists()
    assert not (root / SURVIVORS).exists()


def test_an_uncovered_line_is_never_run(tmp_path):
    root, _ = mutate_repository(tmp_path)
    (root / "coverage" / "lcov.info").write_text(
        "SF:app/rules.py\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,0\nDA:5,0\nDA:6,0\nDA:9,1\nDA:10,1\nend_of_record\n"
    )
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 0
    assert row(read(output), "app/rules.py::grade") == [0, 1, 1, 0.0]


@pytest.mark.parametrize(
    "raw",
    [
        {"test_command": []},
        {"test_command": "pytest"},
        {"test_command": ["pytest", 3]},
        {"test_command": ["pytest", ""]},
        {"test_command": ["t"], "timeout_factor": 0},
        {"test_command": ["t"], "timeout_factor": -1},
        {"test_command": ["t"], "timeout_factor": "10"},
        {"test_command": ["t"], "max_workers": 0},
        {"test_command": ["t"], "max_workers": "2"},
        {"test_command": ["t"], "max_workers": 1.5},
        {"test_command": ["t"], "coverage": "/abs/lcov"},
        {"test_command": ["t"], "crap" + "_overlay": "../crap.json"},
        {"test_command": ["t"], "survivors": ""},
        {"test_command": ["t"], "nope": 1},
    ],
)
def test_bad_settings_are_rejected(raw):
    with pytest.raises(SettingsError):
        sensor.parse_settings(raw)


def test_bad_settings_exit_two_through_the_cli(tmp_path):
    root, _ = mutate_repository(tmp_path)

    assert run_mutate(root, tmp_path / "overlay.json", json.dumps({"crap" + "_overlay": "x"})) == 2


def test_settings_defaults():
    settings = sensor.parse_settings({"test_command": ["t"]})

    assert settings == {
        "test_command": ["t"],
        "timeout_factor": 10.0,
        "max_workers": os.cpu_count() or 1,
        "overlay": OVERLAY,
        "survivors": ".recognizer/cache/mutation/survivors.json",
        "record": ".recognizer/cache/mutation/record.json",
        "incremental": True,
        "max_minutes": None,
    }


def test_the_timeout_has_a_two_second_floor():
    assert sensor.timeout_for(0.05, 10) == 2.0
    assert sensor.timeout_for(1.0, 10) == 10.0


def test_a_dirty_tree_is_recorded_as_modified(tmp_path):
    root, _ = mutate_repository(tmp_path)
    (root / "app" / "rules.py").write_text((root / "app" / "rules.py").read_text() + "\n")
    output = tmp_path / "overlay.json"

    run_mutate(root, output, mutate_settings("tests/weak.py"))

    assert read(output)["modified"] is True


def covered_target(start_line, end_line):
    return sensor.Target("id", "module", "f.py", "f", start_line, end_line)


def site_at(line, start_byte=0, end_byte=1):
    return sensor.Site(line, 0, start_byte, end_byte, "==", "!=")


def test_a_site_on_a_continuation_line_takes_the_preceding_instrumented_line():
    target = covered_target(10, 20)

    assert sensor.site_is_covered(site_at(13), target, {11: 4, 15: 0}) is True
    assert sensor.site_is_covered(site_at(16), target, {11: 4, 15: 0}) is False


def test_a_site_before_any_instrumented_line_in_its_function_is_uncovered():
    target = covered_target(10, 20)

    assert sensor.site_is_covered(site_at(11), target, {5: 3, 14: 3}) is False
    assert sensor.site_is_covered(site_at(11), target, {}) is False


def test_a_site_in_a_nested_unit_function_belongs_to_the_nested_function():
    sites = [site_at(3, 30, 32), site_at(8, 80, 82)]
    spans = [(0, 200), (50, 120)]

    owned = sensor.innermost(sites, spans)

    assert owned == {0: [sites[0]], 1: [sites[1]]}


RECORD = ".recognizer/cache/mutation/record.json"

COUNTING_SCRIPT = """
import os, runpy, sys
with open(os.environ["RUN_LOG"], "a") as log:
    log.write("run\\n")
runpy.run_path(os.path.join(os.getcwd(), "tests", sys.argv[1]), run_name="__main__")
"""


@pytest.fixture
def counting(tmp_path, monkeypatch):
    script = tmp_path / "counting.py"
    script.write_text(COUNTING_SCRIPT)
    log = tmp_path / "runs.log"
    monkeypatch.setenv("RUN_LOG", str(log))

    def settings(test="strong.py", **extra):
        return json.dumps(
            {
                "test_command": [sys.executable, str(script), test],
                "coverage": COVERAGE,
                **extra,
            }
        )

    def runs():
        return len(log.read_text().splitlines()) if log.exists() else 0

    return settings, runs


def summary(capsys):
    lines = [
        line
        for line in capsys.readouterr().err.splitlines()
        if line.startswith("recognizer-sensors: mutation: ") and "functions reused" in line
    ]

    assert len(lines) == 1

    return lines[0].removeprefix("recognizer-sensors: mutation: ")


def git(root, *args):
    env = {
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
        "PATH": os.environ["PATH"],
    }
    subprocess.run(["git", "-C", str(root), *args], check=True, env=env, capture_output=True)


def first_run(tmp_path, counting, capsys):
    settings, runs = counting
    root, commit = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys) == (
        "0 of 3 functions reused, 3 mutated, 0 skipped (uncovered-by-budget)"
    )

    return root, commit, output, runs()


def test_an_unchanged_rerun_reuses_every_function_and_runs_no_test_command(
    tmp_path, counting, capsys
):
    settings, runs = counting
    root, _, output, after_first = first_run(tmp_path, counting, capsys)
    first_overlay = read(output)
    record = read(root / RECORD)

    assert record["record_version"] == 3
    assert record["skipped"] == []
    assert record["functions"]["app/rules.py::grade"]["verdicts"] == ["killed", "killed"]
    assert record["functions"]["app/rules.py::total"]["verdicts"] == [None]

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys) == (
        "3 of 3 functions reused, 0 mutated, 0 skipped (uncovered-by-budget)"
    )
    assert runs() == after_first
    assert read(output)["values"] == first_overlay["values"]
    assert read(root / RECORD)["functions"] == record["functions"]

    survivors = read(root / SURVIVORS)

    assert survivors["reused"] == len(first_overlay["values"]["killed"])
    assert survivors["complete"] is True
    assert survivors["skipped"] == []


def test_a_changed_body_re_mutates_only_that_function(tmp_path, counting, capsys):
    settings, runs = counting
    root, _, output, after_first = first_run(tmp_path, counting, capsys)
    rules = root / "app" / "rules.py"
    rules.write_text(rules.read_text().replace("return a and b", "return b and a"))

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys) == (
        "2 of 3 functions reused, 1 mutated, 0 skipped (uncovered-by-budget)"
    )
    assert runs() == after_first + 2


@pytest.mark.parametrize(
    "damage",
    [
        lambda path: path.write_text("not json"),
        lambda path: path.write_text(json.dumps({**read(path), "record_version": 4})),
        lambda path: path.write_text(json.dumps({**read(path), "commit": 7})),
        lambda path: path.unlink(),
    ],
    ids=["corrupt", "other-version", "no-commit", "missing"],
)
def test_an_unusable_record_means_a_full_run(tmp_path, counting, capsys, damage):
    settings, runs = counting
    root, _, output, after_first = first_run(tmp_path, counting, capsys)
    damage(root / RECORD)

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys).startswith("0 of 3 functions reused")
    assert runs() == after_first * 2


def test_a_changed_command_argument_means_a_full_run(tmp_path, counting, capsys):
    settings, runs = counting
    root, _, output, after_first = first_run(tmp_path, counting, capsys)

    assert (
        run_mutate(
            root,
            output,
            settings("strong.py", max_workers=1).replace('"strong.py"', '"strong.py", "extra"'),
        )
        == 0
    )
    assert summary(capsys).startswith("0 of 3 functions reused")


def test_incremental_false_ignores_the_record_and_prints_no_stale_line(tmp_path, counting, capsys):
    settings, runs = counting
    root, _, output, after_first = first_run(tmp_path, counting, capsys)

    assert run_mutate(root, output, settings(max_workers=1, incremental=False)) == 0

    err = capsys.readouterr().err

    assert "0 of 3 functions reused" in err
    assert "test files changed" not in err
    assert runs() == after_first * 2
    assert read(root / RECORD)["functions"]


def test_a_changed_covered_site_set_re_mutates_that_function(tmp_path, counting, capsys):
    settings, _ = counting
    root, _, output, _ = first_run(tmp_path, counting, capsys)
    (root / "coverage" / "lcov.info").write_text(
        "SF:app/rules.py\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,0\nDA:5,0\nDA:6,0\nDA:9,1\nDA:10,1\nDA:13,0\nDA:14,0\nend_of_record\n"
    )

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys) == (
        "3 of 3 functions reused, 0 mutated, 0 skipped (uncovered-by-budget)"
    )
    assert row(read(output), "app/rules.py::grade") == [1, 0, 1, 1.0]


def test_a_function_that_only_moved_keeps_its_verdicts_and_reports_new_lines(
    tmp_path, counting, capsys
):
    settings, runs = counting
    root, _, output, after_first = first_run(tmp_path, counting, capsys)
    rules = root / "app" / "rules.py"
    rules.write_text("\n\n" + rules.read_text())
    lcov = root / "coverage" / "lcov.info"
    shifted = [
        f"DA:{int(line[3:].split(',')[0]) + 2},{line.split(',')[1]}"
        if line.startswith("DA:")
        else line
        for line in lcov.read_text().splitlines()
    ]
    lcov.write_text("\n".join(shifted) + "\n")

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys).startswith("3 of 3 functions reused")
    assert runs() == after_first
    assert read(root / SURVIVORS)["complete"] is True


def test_a_mixed_run_reports_the_sum(tmp_path, counting, capsys):
    settings, _ = counting
    root, _, output, _ = first_run(tmp_path, counting, capsys)
    rules = root / "app" / "rules.py"
    rules.write_text(rules.read_text().replace("return a and b", "return b and a"))
    before = read(output)["values"]

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert read(output)["values"] == before


def edit_test(root):
    path = root / "tests" / "strong.py"
    path.write_text(path.read_text() + "\n")


def add_untracked_test(root):
    (root / "tests" / "extra.py").write_text("x = 1\n")


def delete_test(root):
    (root / "tests" / "weak.py").unlink()


def edit_conftest(root):
    (root / "conftest.py").write_text("x = 1\n")


@pytest.mark.parametrize(
    ("change", "reused"),
    [
        (edit_test, 0),
        (add_untracked_test, 0),
        (delete_test, 0),
        (edit_conftest, 1),
    ],
    ids=["edited", "untracked", "deleted", "conftest"],
)
def test_a_changed_test_file_forces_a_full_run(tmp_path, counting, capsys, change, reused):
    settings, runs = counting
    root, commit, output, after_first = first_run(tmp_path, counting, capsys)
    change(root)

    assert run_mutate(root, output, settings(max_workers=1)) == 0

    err = capsys.readouterr().err

    assert "test files changed" not in err
    assert f"{reused} of 3 functions reused, {3 - reused} mutated" in err
    assert runs() > after_first
    assert read(root / RECORD)["commit"] == commit


def test_a_committed_test_change_triggers_the_full_run(tmp_path, counting, capsys):
    settings, _ = counting
    root, commit, output, _ = first_run(tmp_path, counting, capsys)
    edit_test(root)
    git(root, "add", "tests/strong.py")
    git(root, "commit", "-q", "-m", "edit")

    assert run_mutate(root, output, settings(max_workers=1), "--commit", commit) == 0

    err = capsys.readouterr().err

    assert "test files changed since" not in err
    assert "0 of 3 functions reused" in err


def test_a_record_whose_commit_is_unknown_is_still_reused(tmp_path, counting, capsys):
    settings, runs = counting
    root, _, output, after_first = first_run(tmp_path, counting, capsys)
    record = read(root / RECORD)
    record["commit"] = "0" * 40
    (root / RECORD).write_text(json.dumps(record))

    assert run_mutate(root, output, settings(max_workers=1)) == 0

    err = capsys.readouterr().err

    assert "cannot compare" not in err
    assert "3 of 3 functions reused" in err
    assert runs() == after_first


def test_a_non_test_edit_does_not_trigger_the_stale_check(tmp_path, counting, capsys):
    settings, _ = counting
    root, _, output, _ = first_run(tmp_path, counting, capsys)
    (root / "notes.txt").write_text("x\n")

    assert run_mutate(root, output, settings(max_workers=1)) == 0

    err = capsys.readouterr().err

    assert "test files changed" not in err
    assert "3 of 3 functions reused" in err


class Ticker:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def run_three(budget_minutes):
    ticker = Ticker()

    def run_item(item):
        ticker.now += 4 * 60

        return [item]

    results = runner.run_functions(["f1", "f2", "f3"], run_item, 1, budget_minutes * 60, ticker)

    return [r is not None for r in results]


@pytest.mark.parametrize(
    ("budget", "ran"),
    [(10, [True, True, True]), (8, [True, True, False]), (6, [True, True, False])],
)
def test_the_budget_worked_examples(budget, ran):
    assert run_three(budget) == ran


def plan(index):
    return (["true"], 1.0)


def test_a_function_whose_deadline_passes_between_mutants_returns_none(tmp_path, monkeypatch):
    ticker = Ticker()
    ran = []

    def fake_run_mutant(repository, work, number, mutant, command, timeout, *rest, **extra):
        ran.append(mutant)
        ticker.now += 60

        return runner.MutantResult("killed")

    monkeypatch.setattr(runner, "run_mutant", fake_run_mutant)

    assert (
        runner.run_function(tmp_path, tmp_path, ["a", "b", "c"], plan, deadline=90.0, clock=ticker)
        is None
    )
    assert ran == ["a", "b"]


def test_a_function_whose_deadline_passes_while_planning_runs_no_mutant(tmp_path, monkeypatch):
    ticker = Ticker()
    ran = []

    def slow_plan(index):
        ticker.now += 100

        return (["true"], 1.0)

    monkeypatch.setattr(runner, "run_mutant", lambda *args, **extra: ran.append(args))

    assert (
        runner.run_function(tmp_path, tmp_path, ["a", "b"], slow_plan, deadline=90.0, clock=ticker)
        is None
    )
    assert ran == []


def test_a_function_finishes_when_the_deadline_is_never_reached(tmp_path, monkeypatch):
    ticker = Ticker()
    monkeypatch.setattr(runner, "run_mutant", lambda *args, **extra: runner.MutantResult("killed"))

    results = runner.run_function(tmp_path, tmp_path, ["a", "b"], plan, deadline=90.0, clock=ticker)

    assert [r.verdict for r in results] == ["killed", "killed"]


def test_a_budget_that_passes_mid_function_lists_it_uncovered_by_budget(
    tmp_path, counting, capsys, monkeypatch
):
    settings, _ = counting
    root, _ = mutate_repository(tmp_path)
    ticker = Ticker()
    monkeypatch.setattr(sensor, "CLOCK", ticker)
    real = runner.run_mutant

    def slow(*args, **extra):
        ticker.now += 120

        return real(*args, **extra)

    monkeypatch.setattr(runner, "run_mutant", slow)

    assert run_mutate(root, tmp_path / "overlay.json", settings(max_workers=1, max_minutes=1)) == 0
    assert "uncovered-by-budget" in summary(capsys)
    assert read(root / SURVIVORS)["skipped"]


def test_no_deadline_runs_every_function():
    assert runner.run_functions(["a", "b"], lambda i: [i], 1, None, Ticker()) == [["a"], ["b"]]


def test_a_budgeted_run_skips_what_it_could_not_start_and_the_next_run_resumes(
    tmp_path, counting, capsys, monkeypatch
):
    settings, _ = counting
    root, commit = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    ticker = Ticker()
    real = runner.run_function
    started = []

    def stepping(*args, **extra):
        started.append(1)
        result = real(*args, **extra)

        if len(started) == 1:
            ticker.now = 1000.0

        return result

    monkeypatch.setattr(sensor, "CLOCK", ticker)
    monkeypatch.setattr(sensor, "run_function", stepping)

    assert run_mutate(root, output, settings(max_workers=1, max_minutes=1)) == 0
    assert summary(capsys) == (
        "0 of 3 functions reused, 2 mutated, 1 skipped (uncovered-by-budget)"
    )

    budgeted = read(tmp_path / "findings-overlay.json")

    assert budgeted["partial"] == {"measured": 2, "total": 3}
    assert "stopped" not in budgeted

    overlay = read(output)

    for name in ("killed", "survived", "uncovered", "score"):
        assert "app/rules.py::grade" not in overlay["values"][name]

    assert row(overlay, "app/rules.py::both") == [1, 0, 0, 1.0]

    survivors = read(root / SURVIVORS)

    assert survivors["complete"] is False
    assert survivors["skipped"] == [
        {"identity": "app/rules.py::grade", "reason": "uncovered-by-budget"}
    ]
    assert read(root / RECORD)["skipped"] == ["app/rules.py::grade"]
    assert "app/rules.py::grade" not in read(root / RECORD)["functions"]

    monkeypatch.setattr(sensor, "CLOCK", time.monotonic)

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys) == (
        "2 of 3 functions reused, 1 mutated, 0 skipped (uncovered-by-budget)"
    )
    assert row(read(output), "app/rules.py::grade") == [2, 0, 0, 1.0]
    assert read(root / SURVIVORS)["complete"] is True
    assert read(root / RECORD)["skipped"] == []


def test_skipped_functions_are_queued_first():
    pending = [
        sensor.Target("a", "m", "f", "a", 1, 2),
        sensor.Target("b", "m", "f", "b", 1, 2),
        sensor.Target("c", "m", "f", "c", 1, 2),
    ]

    assert [t.identity for t in sensor.queue_order(pending, ["c"])] == ["c", "a", "b"]


def test_a_timed_out_mutant_is_a_kill_named_in_timeouts_and_not_a_survivor(tmp_path):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/slow_on_mutant.py")) == 0

    survivors = read(root / SURVIVORS)
    grade = survivors["functions"]["app/rules.py::grade"]

    assert grade["timeouts"] == [{"line": 2, "operator": ">=", "replacement": ">"}]
    assert len(grade["survivors"]) == 1
    assert row(read(output), "app/rules.py::grade") == [1, 1, 0, 0.5]
    assert read(root / RECORD)["functions"]["app/rules.py::grade"]["verdicts"] == [
        "timeout",
        "survived",
    ]


@pytest.mark.parametrize("bad", [0, -1, True, "5"])
def test_a_bad_max_minutes_is_rejected(bad):
    with pytest.raises(SettingsError):
        sensor.parse_settings({"test_command": ["t"], "max_minutes": bad})


@pytest.mark.parametrize("bad", [1, "yes", None])
def test_a_non_boolean_incremental_is_rejected(bad):
    with pytest.raises(SettingsError):
        sensor.parse_settings({"test_command": ["t"], "incremental": bad})


def test_the_new_settings_are_accepted():
    settings = sensor.parse_settings(
        {"test_command": ["t"], "max_minutes": 2, "incremental": False, "record": "r/x.json"}
    )

    assert settings["max_minutes"] == 2.0
    assert settings["incremental"] is False
    assert settings["record"] == "r/x.json"


def findings_of(root, tmp_path, script):
    output = tmp_path / "findings.json"

    assert (
        main(
            [
                "mutation",
                "--repository",
                str(root),
                "--output",
                str(output),
                "--settings",
                mutate_settings(script),
            ]
        )
        == 0
    )

    return read(output)


def test_the_weak_run_yields_one_warning_per_function_with_a_survivor(tmp_path):
    root, commit = mutate_repository(tmp_path)

    document = findings_of(root, tmp_path, "tests/weak.py")

    Draft202012Validator(read(FINDINGS_SCHEMA)).validate(document)
    assert document["commit"] == commit
    assert document["sensor"]["name"] == "mutation"
    assert [(f["id"], f["summary"]) for f in document["findings"]] == [
        (
            "mutation:app/rules.py::both",
            "both in app/rules.py has 1 surviving mutation: line 10 and to or",
        ),
        (
            "mutation:app/rules.py::grade",
            "grade in app/rules.py has 2 surviving mutations: line 2 >= to >, line 4 >= to >",
        ),
    ]

    finding = document["findings"][1]

    assert finding["kind"] == "mutation"
    assert finding["severity"] == "warning"
    assert finding["principle"] == "Tests must catch changes"
    assert finding["fix_pattern"] == "strengthen-tests"
    assert finding["evidence"]["modules"] == ["app/rules.py"]
    assert finding["evidence"]["members"] == [
        {"module": "app/rules.py", "name": "grade", "file": "app/rules.py", "lines": [1, 6]}
    ]
    assert finding["evidence"]["measures"] == {
        "killed": 0,
        "survived": 2,
        "uncovered": 0,
        "score": 0.0,
    }


def test_the_strong_run_yields_no_findings(tmp_path):
    root, _ = mutate_repository(tmp_path)

    assert findings_of(root, tmp_path, "tests/strong.py")["findings"] == []


def test_a_removed_not_reads_as_removed():
    assert (
        sensor.describe({"line": 3, "operator": "not", "replacement": ""}) == "line 3 not removed"
    )


def test_one_run_writes_the_survivors_the_record_the_overlay_and_the_findings(tmp_path):
    root, _ = mutate_repository(tmp_path)

    findings_of(root, tmp_path, "tests/weak.py")

    assert (root / SURVIVORS).is_file()
    assert (root / RECORD).is_file()
    assert (root / OVERLAY).is_file()


def test_a_run_removes_the_retired_mutate_overlay(tmp_path):
    root, _ = mutate_repository(tmp_path)
    retired = root / ".recognizer" / "cache" / "overlays" / "mutate.json"
    retired.parent.mkdir(parents=True, exist_ok=True)
    retired.write_text("{}")

    findings_of(root, tmp_path, "tests/weak.py")

    assert not retired.exists()


def test_a_failing_run_leaves_a_prior_overlay_alone(tmp_path):
    root, _ = mutate_repository(tmp_path)
    findings_of(root, tmp_path, "tests/weak.py")
    before = (root / OVERLAY).read_bytes()
    settings = json.dumps(
        {
            "test_command": ["python3", "-c", "raise SystemExit(1)"],
            "coverage": COVERAGE,
            "incremental": False,
        }
    )

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2
    assert (root / OVERLAY).read_bytes() == before


def test_the_record_hash_for_a_set_test_command_is_the_hash_of_the_array(tmp_path):
    root, _ = mutate_repository(tmp_path)
    command = [sys.executable, "tests/weak.py"]

    findings_of(root, tmp_path, "tests/weak.py")

    expected = hashlib.sha256(json.dumps(command, separators=(",", ":")).encode()).hexdigest()

    assert read(root / RECORD)["command"] == expected


def test_the_defaults_match_the_registry():
    registry = json.loads(SENSOR_LIST.read_text())
    entry = next(e for e in registry if e["name"] == "mutation")

    assert sensor.METRICS == entry["metrics"]
    assert entry["defaults"] == {}


def test_each_language_runs_its_own_mutant_command(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path)
    (root / "app" / "view.ts").write_text("export function big(a: number) { return a >= 1; }\n")
    git(root, "add", "app/view.ts")
    git(root, "commit", "-q", "-m", "ts")
    (root / ".recognizer/cache/scan.typescript.json").write_text(
        json.dumps(
            {
                "files": [{"path": "app/view.ts", "hash": "0" * 64}],
                "modules": [{"id": "app/view.ts"}],
                "modified": False,
            }
        )
    )
    (root / "coverage" / "lcov.info").write_text(
        (root / "coverage" / "lcov.info").read_text() + "SF:app/view.ts\nDA:1,1\nend_of_record\n"
    )
    seen = []
    real = runner.run_test_command

    def spy(command, cwd, timeout):
        seen.append(command)

        return real([sys.executable, "tests/weak.py"], cwd, timeout)

    monkeypatch.setattr(sensor, "run_test_command", spy)
    settings = json.dumps({"coverage": COVERAGE, "incremental": False, "max_workers": 1})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert ["npm", "test"] in seen
    assert any("pytest" in command for command in seen)


@pytest.mark.parametrize(
    ("module_id", "expected"),
    [
        ("shop/test_place.py", True),
        ("shop/place_test.py", True),
        ("shop/conftest.py", True),
        ("api/src/place.spec.ts", True),
        ("app/src/main/kotlin/shop/FooTest.kt", True),
        ("tests/helper.py", True),
        ("shop/place.py", False),
        ("api/src/contest.ts", False),
    ],
)
def test_is_test_file_follows_the_shared_convention(module_id, expected):
    from recognizer_sensors.mutation.test_files import is_test_file

    assert is_test_file(module_id) is expected


SLEEP_WHEN_STOPPING = """
import os, sys, time

where, pid_file = sys.argv[1], sys.argv[2]
here = os.getcwd()
hang = "baseline" in here if where == "baseline" else "/work/" in here and "baseline" not in here

if hang:
    with open(pid_file, "w") as handle:
        handle.write(str(os.getpid()))

    time.sleep(60)
"""


def start_sensor(root, tmp_path, settings, env=None):
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "recognizer_sensors",
            "mutation",
            "--repository",
            str(root),
            "--output",
            str(tmp_path / "findings.json"),
            "--settings",
            settings,
        ],
        process_group=0,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def stop_the_sensor_while_hung(tmp_path, where):
    root, _ = mutate_repository(tmp_path)
    pid_file = tmp_path / "pid.txt"
    script = tmp_path / "hang.py"
    script.write_text(SLEEP_WHEN_STOPPING)
    settings = mutate_settings(str(script), timeout_factor=100)
    settings = json.dumps(
        {
            **json.loads(settings),
            "test_command": [sys.executable, str(script), where, str(pid_file)],
        }
    )
    process = start_sensor(root, tmp_path, settings)
    deadline = time.monotonic() + 30

    while not pid_file.exists() and time.monotonic() < deadline:
        time.sleep(0.05)

    pid = int(pid_file.read_text())
    os.killpg(process.pid, signal.SIGTERM)
    status = process.wait(timeout=60)
    deadline = time.monotonic() + 10

    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break

        time.sleep(0.05)

    return root, pid, status


@pytest.mark.parametrize("where", ["mutant", "baseline"])
def test_sigterm_to_the_sensors_group_ends_the_hung_test_process_and_removes_the_work_folder(
    tmp_path, where
):
    root, pid, status = stop_the_sensor_while_hung(tmp_path, where)

    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)

    assert status == 143
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()

    findings = read(tmp_path / "findings.json")

    assert findings["stopped"] == {"measured": 1, "total": 3}
    assert findings["findings"] == []
    assert read(root / RECORD)["skipped"] == ["app/rules.py::both", "app/rules.py::grade"]
    assert set(read(root / RECORD)["functions"]) == {"app/rules.py::total"}


def test_sigterm_during_the_coverage_pass_writes_a_stopped_document_with_nothing_measured(tmp_path):
    root, _ = mutate_repository(tmp_path)
    marker = tmp_path / "hung.txt"
    fake = tmp_path / "bin"
    fake.mkdir()
    runner_stub = fake / "python3"
    runner_stub.write_text(f"#!/bin/sh\necho hung > {marker}\nexec sleep 60\n")
    runner_stub.chmod(0o755)
    env = {**os.environ, "PATH": f"{fake}{os.pathsep}{os.environ['PATH']}"}
    settings = json.dumps({"test_command": [sys.executable, "-c", "pass"]})
    process = start_sensor(root, tmp_path, settings, env)
    deadline = time.monotonic() + 30

    while not marker.exists() and time.monotonic() < deadline:
        time.sleep(0.05)

    assert marker.exists()

    os.killpg(process.pid, signal.SIGTERM)

    assert process.wait(timeout=60) == 143

    findings = read(tmp_path / "findings.json")

    assert findings["stopped"] == {"measured": 0, "total": 0}
    assert findings["findings"] == []
    assert not (root / RECORD).exists()
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()


def test_the_live_session_registry_empties_after_a_normal_and_a_timed_out_run(tmp_path):
    runner.run_test_command([sys.executable, "-c", "pass"], tmp_path, 30)
    assert runner.LIVE == set()

    result = runner.run_test_command(
        [sys.executable, "-c", "import time; time.sleep(60)"], tmp_path, 0.3
    )

    assert result.timed_out
    assert runner.LIVE == set()


def test_a_run_with_nothing_to_mutate_leaves_the_sigterm_handler_alone(tmp_path):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    before = signal.getsignal(signal.SIGTERM)

    assert run_mutate(root, output, mutate_settings("tests/strong.py")) == 0
    assert run_mutate(root, output, mutate_settings("tests/strong.py")) == 0
    assert signal.getsignal(signal.SIGTERM) == before


STOP_AFTER_THE_FIRST_FUNCTION = """
import os, runpy, signal, sys, time

counter, test, stop_at = sys.argv[1], sys.argv[2], int(sys.argv[3])
here = os.getcwd()

if "/work/" in here and "baseline" not in here:
    with open(counter, "a") as handle:
        handle.write("mutant\\n")

    with open(counter) as handle:
        count = len(handle.read().splitlines())

    if count == stop_at:
        os.killpg(os.getpgid(os.getppid()), signal.SIGTERM)
        time.sleep(60)

runpy.run_path(os.path.join(here, "tests", test), run_name="__main__")
"""

ALPHA = "app/rules.py::alpha"
BETA = "app/rules.py::beta"
GAMMA = "app/rules.py::gamma"


def test_a_stopped_run_keeps_the_function_it_finished_and_the_next_run_resumes(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)
    script = tmp_path / "stop_after_first.py"
    script.write_text(STOP_AFTER_THE_FIRST_FUNCTION)
    settings = json.dumps(
        {
            "test_command": [
                sys.executable,
                str(script),
                str(tmp_path / "counter.txt"),
                "strong.py",
                "2",
            ],
            "coverage": COVERAGE,
            "max_workers": 1,
        }
    )

    assert start_sensor(root, tmp_path, settings).wait(timeout=60) == 143

    record = read(root / RECORD)

    assert list(record["functions"]) == [ALPHA]
    assert record["functions"][ALPHA]["verdicts"] == ["killed"]
    assert len(record["functions"][ALPHA]["body"]) == 64
    assert record["skipped"] == [BETA, GAMMA]

    findings = read(tmp_path / "findings.json")
    overlay = read(root / OVERLAY)

    assert findings["stopped"] == {"measured": 1, "total": 3}
    assert findings["partial"] == {"measured": 1, "total": 3}
    assert list(overlay["values"]["killed"]) == [ALPHA]
    assert list(read(root / SURVIVORS)["skipped"]) == [
        {"identity": BETA, "reason": "uncovered-by-budget"},
        {"identity": GAMMA, "reason": "uncovered-by-budget"},
    ]
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert summary(capsys) == "1 of 3 functions reused, 2 mutated, 0 skipped (uncovered-by-budget)"
    assert sorted(read(root / RECORD)["functions"]) == [ALPHA, BETA, GAMMA]
    assert read(root / RECORD)["skipped"] == []
    assert "stopped" not in read(tmp_path / "findings-overlay.json")
    assert "partial" not in read(tmp_path / "findings-overlay.json")


def test_a_run_stopped_before_its_first_function_finishes_reports_nothing_measured(tmp_path):
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)
    script = tmp_path / "stop_in_the_first.py"
    script.write_text(STOP_AFTER_THE_FIRST_FUNCTION)
    settings = json.dumps(
        {
            "test_command": [
                sys.executable,
                str(script),
                str(tmp_path / "counter.txt"),
                "strong.py",
                "1",
            ],
            "coverage": COVERAGE,
            "max_workers": 1,
        }
    )

    assert start_sensor(root, tmp_path, settings).wait(timeout=60) == 143

    findings = read(tmp_path / "findings.json")

    assert findings["stopped"] == {"measured": 0, "total": 3}
    assert findings["partial"] == {"measured": 0, "total": 3}
    assert findings["findings"] == []
    assert read(root / RECORD)["functions"] == {}
    assert read(root / RECORD)["skipped"] == [ALPHA, BETA, GAMMA]
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()


def carry_settings(tmp_path, stop_at, **extra):
    script = tmp_path / "stop_after_first.py"
    script.write_text(STOP_AFTER_THE_FIRST_FUNCTION)

    return json.dumps(
        {
            "test_command": [
                sys.executable,
                str(script),
                str(tmp_path / "counter-carry.txt"),
                "strong.py",
                str(stop_at),
            ],
            "coverage": COVERAGE,
            "max_workers": 1,
            **extra,
        }
    )


def change_gamma(root):
    rules = root / "app" / "rules.py"
    rules.write_text(
        rules.read_text().replace(
            "def gamma(a, b):\n    return a and b", "def gamma(a, b):\n    return b and a"
        )
    )


def test_a_stopped_run_carries_the_previous_verdicts_of_the_functions_it_did_not_reach(tmp_path):
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)

    assert run_mutate(root, tmp_path / "overlay.json", carry_settings(tmp_path, 5)) == 0

    complete = read(tmp_path / "findings-overlay.json")
    first = read(root / RECORD)

    assert complete["counts"] == {"measured": 3, "total": 3}
    assert "stopped" not in complete
    assert "partial" not in complete

    change_gamma(root)

    assert (
        start_sensor(root, tmp_path, carry_settings(tmp_path, 5, incremental=False)).wait(
            timeout=60
        )
        == 143
    )

    record = read(root / RECORD)

    assert record["functions"][BETA] == first["functions"][BETA]
    assert GAMMA not in record["functions"]
    assert record["skipped"] == [BETA, GAMMA]

    findings = read(tmp_path / "findings.json")

    assert findings["counts"] == {"measured": 1, "total": 3}
    assert findings["stopped"] == {"measured": 1, "total": 3}
    assert list(read(root / OVERLAY)["values"]["killed"]) == [ALPHA]
    assert [entry["identity"] for entry in read(root / SURVIVORS)["skipped"]] == [BETA, GAMMA]


def test_a_budget_ended_run_carries_the_previous_verdicts_of_the_functions_it_did_not_reach(
    tmp_path, monkeypatch
):
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)

    assert run_mutate(root, tmp_path / "overlay.json", carry_settings(tmp_path, 5)) == 0

    first = read(root / RECORD)

    change_gamma(root)

    ticker = Ticker()
    real = runner.run_function
    started = []

    def stepping(*args, **extra):
        started.append(1)
        result = real(*args, **extra)

        if len(started) == 1:
            ticker.now = 1000.0

        return result

    monkeypatch.setattr(sensor, "CLOCK", ticker)
    monkeypatch.setattr(sensor, "run_function", stepping)

    settings = carry_settings(tmp_path, 5, incremental=False, max_minutes=1)

    assert run_mutate(root, tmp_path / "overlay2.json", settings) == 0

    record = read(root / RECORD)
    unreached = record["skipped"]

    assert unreached == [BETA, GAMMA]
    assert record["functions"][BETA] == first["functions"][BETA]
    assert GAMMA not in record["functions"]

    findings = read(tmp_path / "findings-overlay2.json")

    assert findings["counts"] == {"measured": 1, "total": 3}
    assert findings["partial"] == {"measured": 1, "total": 3}
    assert "stopped" not in findings


HOLD_THE_PIPE_WHEN_STOPPING = """
import os, subprocess, sys, time

pid_file = sys.argv[1]
here = os.getcwd()

if "/work/" in here and "baseline" not in here:
    holder = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True
    )

    with open(pid_file, "w") as handle:
        handle.write(str(holder.pid))

    time.sleep(60)
"""


def test_a_second_sigterm_during_a_stalled_wind_down_exits_at_once(tmp_path):
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)
    pid_file = tmp_path / "holder.txt"
    script = tmp_path / "hold.py"
    script.write_text(HOLD_THE_PIPE_WHEN_STOPPING)
    settings = json.dumps(
        {
            "test_command": [sys.executable, str(script), str(pid_file)],
            "coverage": COVERAGE,
            "max_workers": 1,
        }
    )
    process = start_sensor(root, tmp_path, settings)
    holder = None

    try:
        deadline = time.monotonic() + 30

        while not pid_file.exists() and time.monotonic() < deadline:
            time.sleep(0.05)

        holder = int(pid_file.read_text())
        os.kill(process.pid, signal.SIGTERM)

        with pytest.raises(subprocess.TimeoutExpired):
            process.wait(timeout=2)

        os.kill(process.pid, signal.SIGTERM)
        started = time.monotonic()

        assert process.wait(timeout=10) == 143
        assert time.monotonic() - started < runner.STOP_GRACE_SECONDS
    finally:
        if process.poll() is None:
            process.kill()

        if holder is not None:
            try:
                os.kill(holder, signal.SIGKILL)
            except ProcessLookupError:
                pass


def test_a_completed_run_writes_no_stopped_key(tmp_path):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/strong.py")) == 0
    assert "stopped" not in read(tmp_path / "findings-overlay.json")
    assert "partial" not in read(tmp_path / "findings-overlay.json")


def record_after_each_function(tmp_path, monkeypatch, gaps):
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)
    ticker = Ticker()
    records = []
    path = root / RECORD
    monkeypatch.setattr(sensor, "CLOCK", ticker)
    gaps = iter(gaps)
    real = runner.run_function

    def run_function(*args, **extra):
        ticker.now += next(gaps)
        records.append(sorted(read(path)["functions"]) if path.exists() else None)

        return real(*args, **extra)

    monkeypatch.setattr(sensor, "run_function", run_function)
    settings = mutate_settings("tests/strong.py", max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    return records


def test_a_long_run_checkpoints_its_record_only_once_the_interval_has_passed(tmp_path, monkeypatch):
    interval = sensor.CHECKPOINT_SECONDS
    records = record_after_each_function(tmp_path, monkeypatch, [0, interval, 0])

    assert records == [None, None, [ALPHA, BETA]]


def progress_lines(capsys):
    return [
        json.loads(line.removeprefix("recognizer-progress "))
        for line in capsys.readouterr().err.splitlines()
        if line.startswith("recognizer-progress ")
    ]


def test_progress_is_quiet_unless_the_switch_is_one(tmp_path, counting, capsys, monkeypatch):
    settings, _ = counting
    root, _ = mutate_repository(tmp_path)

    monkeypatch.delenv("RECOGNIZER_PROGRESS", raising=False)

    assert run_mutate(root, tmp_path / "overlay.json", settings(max_workers=1)) == 0
    assert "recognizer-progress" not in capsys.readouterr().err

    monkeypatch.setenv("RECOGNIZER_PROGRESS", "0")

    assert (
        run_mutate(root, tmp_path / "overlay.json", settings(max_workers=1, incremental=False)) == 0
    )
    assert "recognizer-progress" not in capsys.readouterr().err


def test_progress_reports_coverage_then_functions_rising_to_the_total(
    tmp_path, counting, capsys, monkeypatch
):
    settings, _ = counting
    root, _ = mutate_repository(tmp_path)

    monkeypatch.setenv("RECOGNIZER_PROGRESS", "1")

    assert run_mutate(root, tmp_path / "overlay.json", settings(max_workers=1)) == 0

    lines = progress_lines(capsys)
    mutants = lines[1:]

    assert lines[0] == {"step": "coverage"}
    assert [line["step"] for line in mutants] == ["mutants"] * len(mutants)
    assert mutants[0]["done"] == 1
    assert mutants[-1]["done"] == mutants[-1]["total"]
    assert [line["done"] for line in mutants] == sorted(line["done"] for line in mutants)
    assert {line["total"] for line in mutants} == {mutants[0]["total"]}


def test_an_unchanged_rerun_prints_one_mutants_line_with_every_function_done(
    tmp_path, counting, capsys, monkeypatch
):
    settings, _ = counting
    root, _, output, _ = first_run(tmp_path, counting, capsys)

    monkeypatch.setenv("RECOGNIZER_PROGRESS", "1")

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert progress_lines(capsys) == [
        {"step": "coverage"},
        {"step": "mutants", "done": 3, "total": 3},
    ]


def test_reused_functions_count_as_done_from_the_first_line(
    tmp_path, counting, capsys, monkeypatch
):
    settings, _ = counting
    root, _, output, _ = first_run(tmp_path, counting, capsys)
    rules = root / "app" / "rules.py"
    rules.write_text(rules.read_text().replace("return a and b", "return b and a"))

    monkeypatch.setenv("RECOGNIZER_PROGRESS", "1")

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert progress_lines(capsys) == [
        {"step": "coverage"},
        {"step": "mutants", "done": 2, "total": 3},
        {"step": "mutants", "done": 3, "total": 3},
    ]


def test_a_run_cut_by_the_budget_ends_short_of_the_total(tmp_path, counting, capsys, monkeypatch):
    settings, _ = counting
    root, _ = mutate_repository(tmp_path)
    ticks = iter([0.0, 0.0])

    monkeypatch.setattr(sensor, "CLOCK", lambda: next(ticks, 1000.0))
    monkeypatch.setenv("RECOGNIZER_PROGRESS", "1")

    assert run_mutate(root, tmp_path / "overlay.json", settings(max_workers=1, max_minutes=1)) == 0

    mutants = progress_lines(capsys)[1:]

    assert mutants[0]["done"] == 1
    assert mutants[-1]["done"] < mutants[-1]["total"]


def test_a_run_killed_after_a_checkpoint_keeps_it_and_the_rerun_does_only_the_rest(
    tmp_path, monkeypatch
):
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)
    ticker = Ticker()
    monkeypatch.setattr(sensor, "CLOCK", ticker)
    real = runner.run_function
    calls = []

    def killed_from_the_second(*args, **extra):
        calls.append(1)
        ticker.now += sensor.CHECKPOINT_SECONDS

        if len(calls) >= 2:
            raise RuntimeError("killed")

        return real(*args, **extra)

    monkeypatch.setattr(sensor, "run_function", killed_from_the_second)
    settings = mutate_settings("tests/strong.py", max_workers=1)

    with pytest.raises(RuntimeError):
        run_mutate(root, tmp_path / "overlay.json", settings)

    document = read(tmp_path / "findings-overlay.json")

    assert document["partial"] == {"measured": 1, "total": 3}
    assert "stopped" not in document
    assert list(read(root / RECORD)["functions"]) == [ALPHA]
    assert list(read(root / OVERLAY)["values"]["killed"]) == [ALPHA]

    calls.clear()
    monkeypatch.setattr(
        sensor, "run_function", lambda *args, **extra: (calls.append(1), real(*args, **extra))[1]
    )

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert len(calls) == 2
    assert "partial" not in read(tmp_path / "findings-overlay.json")


def test_each_checkpoint_counts_only_settled_functions_and_the_last_is_complete(
    tmp_path, monkeypatch
):
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)
    ticker = Ticker()
    monkeypatch.setattr(sensor, "CLOCK", ticker)
    real = runner.run_function
    seen = []
    findings = tmp_path / "findings-overlay.json"

    def stepping(*args, **extra):
        ticker.now += sensor.CHECKPOINT_SECONDS
        seen.append(read(findings).get("partial") if findings.exists() else None)

        return real(*args, **extra)

    monkeypatch.setattr(sensor, "run_function", stepping)
    settings = mutate_settings("tests/strong.py", max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert seen == [None, {"measured": 1, "total": 3}, {"measured": 2, "total": 3}]
    assert "partial" not in read(findings)


def findings_writes(monkeypatch, path):
    from recognizer_sensors import cli

    writes = []
    real = cli.write_atomically

    def spy(text, target):
        if target == path:
            writes.append(json.loads(text).get("partial"))

        return real(text, target)

    monkeypatch.setattr(cli, "write_atomically", spy)

    return writes


def test_a_checkpoint_writes_only_once_the_gap_reaches_the_interval(tmp_path, monkeypatch):
    interval = sensor.CHECKPOINT_SECONDS
    root, _ = mutate_repository(tmp_path, STOP_FIXTURE)
    ticker = Ticker()
    monkeypatch.setattr(sensor, "CLOCK", ticker)
    writes = findings_writes(monkeypatch, tmp_path / "findings-overlay.json")
    real = runner.run_function
    gaps = iter([interval - 1, 1, interval])
    seen = []

    def stepping(*args, **extra):
        ticker.now += next(gaps)
        seen.append(len(writes))

        return real(*args, **extra)

    monkeypatch.setattr(sensor, "run_function", stepping)

    assert (
        run_mutate(
            root, tmp_path / "overlay.json", mutate_settings("tests/strong.py", max_workers=1)
        )
        == 0
    )
    assert seen == [0, 0, 1]
    assert writes == [{"measured": 2, "total": 3}, None, None]


FIVE_FUNCTIONS = (
    "\n\n\n".join(
        f"def {name}(a, b):\n    return {body}"
        for name, body in [
            ("r", "a and b"),
            ("d", "a and b"),
            ("a", "a and b"),
            ("b", "a and b"),
            ("c", "a and b"),
        ]
    )
    + "\n"
)
FIVE_COVERAGE = (
    "SF:app/rules.py\n"
    + "".join(
        f"DA:{line},{0 if line in (5, 6) else 1}\n" for line in (1, 2, 5, 6, 9, 10, 13, 14, 17, 18)
    )
    + "end_of_record\n"
)
FIVE_TESTS = """import os
import sys

sys.path.insert(0, os.getcwd())

from app.rules import a, b, c, r

for function in (r, a, b, c):
    assert function(True, True) is True
    assert function(True, False) is False
    assert function(False, True) is False
"""


def five_function_fixture(tmp_path):
    fixture = tmp_path / "fixture"
    shutil.copytree(STOP_FIXTURE, fixture)
    (fixture / "app" / "rules.py").write_text(FIVE_FUNCTIONS)
    (fixture / "coverage" / "lcov.info").write_text(FIVE_COVERAGE)
    (fixture / "tests" / "strong.py").write_text(FIVE_TESTS)

    return fixture


def test_the_worked_example_counts_reused_and_uncovered_targets_as_measured(tmp_path, monkeypatch):
    root, _ = mutate_repository(tmp_path, five_function_fixture(tmp_path))
    settings = mutate_settings("tests/strong.py", max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    rules = root / "app" / "rules.py"
    reordered = FIVE_FUNCTIONS.split("def a(")
    rules.write_text(reordered[0] + "def a(" + reordered[1].replace("a and b", "b and a"))

    ticker = Ticker()
    monkeypatch.setattr(sensor, "CLOCK", ticker)
    writes = findings_writes(monkeypatch, tmp_path / "findings-overlay.json")
    real = runner.run_function
    ran = []

    def stepping(*args, **extra):
        ticker.now += sensor.CHECKPOINT_SECONDS
        ran.append(len(writes))

        return real(*args, **extra)

    monkeypatch.setattr(sensor, "run_function", stepping)

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0
    assert ran == [0, 1, 2]
    assert writes[0] == {"measured": 3, "total": 5}
    assert writes[1] == {"measured": 4, "total": 5}


def test_a_scoped_run_keeps_the_out_of_scope_functions_in_the_total(tmp_path, monkeypatch):
    fixture = tmp_path / "fixture"
    shutil.copytree(STOP_FIXTURE, fixture)
    (fixture / "app" / "other.py").write_text("def omega(a, b):\n    return a and b\n")
    (fixture / "coverage" / "lcov.info").write_text(
        (fixture / "coverage" / "lcov.info").read_text()
        + "SF:app/other.py\nDA:1,1\nDA:2,1\nend_of_record\n"
    )
    scan = json.loads((fixture / "scan.python.json").read_text())
    scan["files"].append({"path": "app/other.py", "hash": "1" * 64})
    scan["modules"].append({"id": "app/other.py"})
    (fixture / "scan.python.json").write_text(json.dumps(scan))
    root, _ = mutate_repository(tmp_path, fixture)
    modules = tmp_path / "modules.json"
    modules.write_text(json.dumps(["app/rules.py"]))
    ticker = Ticker()
    monkeypatch.setattr(sensor, "CLOCK", ticker)
    writes = findings_writes(monkeypatch, tmp_path / "findings-overlay.json")
    real = runner.run_function

    def stepping(*args, **extra):
        ticker.now += sensor.CHECKPOINT_SECONDS

        return real(*args, **extra)

    monkeypatch.setattr(sensor, "run_function", stepping)
    settings = mutate_settings("tests/strong.py", max_workers=1)

    assert run_mutate(root, tmp_path / "overlay.json", settings, "--modules", str(modules)) == 0
    assert writes[0] == {"measured": 1, "total": 4}
    assert writes[-1] == {"measured": 3, "total": 4}


def test_only_mutation_is_handed_a_checkpoint():
    from recognizer_sensors.registry import SHIPPED

    assert {name for name, entry in SHIPPED.items() if entry.checkpoints} == {"mutation"}


def test_copy_repository_skips_pycache_at_any_depth_and_keeps_skipping_git_and_cache(tmp_path):
    source = tmp_path / "source"
    (source / "__pycache__").mkdir(parents=True)
    (source / "__pycache__" / "top.cpython-313.pyc").write_bytes(b"x")
    (source / "pkg" / "__pycache__").mkdir(parents=True)
    (source / "pkg" / "__pycache__" / "mod.cpython-313.pyc").write_bytes(b"x")
    (source / "pkg" / "mod.py").write_text("x = 1\n")
    (source / "pkg" / "stray.pyc").write_bytes(b"x")
    (source / ".git").mkdir()
    (source / ".git" / "HEAD").write_text("ref")
    (source / ".recognizer" / "cache").mkdir(parents=True)
    (source / ".recognizer" / "cache" / "scan.json").write_text("{}")
    (source / ".recognizer" / "policy.yaml").write_text("a: 1\n")

    destination = tmp_path / "copy"
    runner.copy_repository(source, destination)

    copied = sorted(str(path.relative_to(destination)) for path in destination.rglob("*"))

    assert copied == [".recognizer", ".recognizer/policy.yaml", "pkg", "pkg/mod.py"]


def git_repository(root, tracked, untracked=(), ignore=""):
    root.mkdir(parents=True, exist_ok=True)

    for relative in (*tracked, *untracked):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(relative)

    (root / ".gitignore").write_text(ignore)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", ".gitignore", *tracked], cwd=root, check=True)

    return root


def ignored_file(root, relative):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("ignored")


def copied_files(destination):
    return sorted(
        str(path.relative_to(destination))
        for path in destination.rglob("*")
        if path.is_file() and not path.is_symlink() or path.is_symlink()
    )


def test_copy_repository_holds_tracked_and_untracked_files_and_leaves_ignored_folders_out(tmp_path):
    source = git_repository(
        tmp_path / "source",
        ["kept.py", "gone.py", "pkg/mod.py"],
        ["fresh.py"],
        ".worktrees/\n.venv/\n.pytest_cache/\n",
    )
    (source / "gone.py").unlink()
    ignored_file(source, ".worktrees/x/file")
    ignored_file(source, ".venv/lib/x")
    ignored_file(source, ".pytest_cache/y")
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination)

    assert copied_files(destination) == [".gitignore", "fresh.py", "kept.py", "pkg/mod.py"]


def test_copy_repository_carries_node_modules_at_any_depth(tmp_path):
    source = git_repository(tmp_path / "source", ["a.js", "app/b.js"], (), "node_modules/\n")
    ignored_file(source, "node_modules/x/index.js")
    ignored_file(source, "app/node_modules/y/index.js")
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination)

    assert (destination / "node_modules/x/index.js").exists()
    assert (destination / "app/node_modules/y/index.js").exists()


def test_copy_repository_carries_target_only_beside_a_tracked_cargo_toml(tmp_path):
    source = git_repository(
        tmp_path / "source", ["rust/Cargo.toml", "other/a.txt"], (), "target/\n"
    )
    ignored_file(source, "rust/target/debug/x")
    ignored_file(source, "other/target/debug/x")
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination)

    assert (destination / "rust/target/debug/x").exists()
    assert not (destination / "other/target").exists()


def test_copy_repository_carries_build_beside_a_gradle_settings_file(tmp_path):
    source = git_repository(
        tmp_path / "source", ["settings.gradle.kts", "x/a.txt"], (), "build/\n.gradle/\n"
    )
    ignored_file(source, "build/classes/x")
    ignored_file(source, ".gradle/y")
    ignored_file(source, "x/build/z")
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination)

    assert (destination / "build/classes/x").exists()
    assert (destination / ".gradle/y").exists()
    assert not (destination / "x/build").exists()


def test_copy_repository_carries_obj_beside_a_tracked_csproj(tmp_path):
    source = git_repository(tmp_path / "source", ["App/App.csproj", "Lib/a.cs"], (), "obj/\nbin/\n")
    ignored_file(source, "App/obj/project.assets.json")
    ignored_file(source, "Lib/obj/project.assets.json")
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination)

    assert (destination / "App/obj/project.assets.json").exists()
    assert not (destination / "Lib/obj").exists()


def test_copy_repository_carries_listed_paths_and_skips_missing_ones(tmp_path):
    source = git_repository(tmp_path / "source", ["a.txt"], (), "gen/\nvendor/\n.venv/\n")
    ignored_file(source, "gen/one.py")
    ignored_file(source, "vendor/two.py")
    ignored_file(source, ".venv/lib/x")
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination, ("gen", "missing", "vendor"))

    assert (destination / "gen/one.py").exists()
    assert (destination / "vendor/two.py").exists()
    assert not (destination / ".venv").exists()


def test_copy_repository_clones_a_listed_directory_whole(tmp_path):
    source = git_repository(tmp_path / "source", ["a.txt"])
    nested = source / "sub"
    nested.mkdir()
    (nested / "inner.txt").write_text("inner")
    subprocess.run(["git", "init", "-q"], cwd=nested, check=True)
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination)

    assert (destination / "sub/inner.txt").read_text() == "inner"


def test_copy_repository_falls_back_to_a_plain_copy_and_stops_trying_to_clone(
    tmp_path, monkeypatch
):
    source = git_repository(tmp_path / "source", ["a.txt", "b.txt", "c/d.txt"])
    calls = []

    def refuse(*args):
        calls.append(args)

        return -1

    monkeypatch.setitem(runner.CLONE_STATE, "enabled", True)
    monkeypatch.setitem(runner.CLONE_STATE, "call", refuse)
    monkeypatch.setattr(runner.ctypes, "get_errno", lambda: errno.ENOTSUP)
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination)

    assert copied_files(destination) == [".gitignore", "a.txt", "b.txt", "c/d.txt"]
    assert len(calls) == 1


def test_copy_repository_never_clones_where_cloning_is_disabled(tmp_path, monkeypatch):
    source = git_repository(tmp_path / "source", ["a.txt"])
    calls = []
    monkeypatch.setitem(runner.CLONE_STATE, "enabled", False)
    monkeypatch.setitem(runner.CLONE_STATE, "call", lambda *args: calls.append(args) or 0)

    runner.copy_repository(source, tmp_path / "copy")

    assert calls == []
    assert (tmp_path / "copy/a.txt").exists()


def test_writing_in_a_copy_leaves_the_original_unchanged(tmp_path):
    source = git_repository(tmp_path / "source", ["a.txt"], (), "node_modules/\n")
    ignored_file(source, "node_modules/x/index.js")
    destination = tmp_path / "copy"

    runner.copy_repository(source, destination)
    (destination / "a.txt").write_text("changed")
    (destination / "node_modules/x/index.js").write_text("changed")

    assert (source / "a.txt").read_text() == "a.txt"
    assert (source / "node_modules/x/index.js").read_text() == "ignored"


@pytest.mark.parametrize("value", ["gen", ["ok", 3], ["/abs"], ["../up"], ["a/../../b"]])
def test_carry_setting_rejects_bad_values(value):
    with pytest.raises(SettingsError):
        sensor.parse_settings({"carry": value})


def test_carry_setting_accepts_relative_paths():
    assert sensor.parse_settings({"carry": ["gen", "x/y/"]})["carry"] == ("gen", "x/y")
    assert "carry" not in sensor.parse_settings({})
