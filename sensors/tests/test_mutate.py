import json
import os
import subprocess
import sys
import time

import pytest
from conftest import (
    MEASURERS_FILE,
    OVERLAY_SCHEMA,
    mutate_repository,
    mutate_settings,
)
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.mutate import measurer, runner
from recognizer_sensors.mutate.runner import new_work_folder, remove_stale_work_folders
from recognizer_sensors.mutation import sensor
from recognizer_sensors.settings import SettingsError

SURVIVORS = ".recognizer/cache/mutation/survivors.json"
CRAP = ".recognizer/cache/overlays/crap.json"


def run_mutate(root, output, settings, *extra):
    return main(
        [
            "mutate",
            "--repository",
            str(root),
            "--output",
            str(output),
            "--settings",
            settings,
            *extra,
        ]
    )


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
        and ".recognizer/cache/mutation" not in p.relative_to(root).as_posix()
    }


def test_weak_tests_leave_the_table_s_survivors(tmp_path):
    root, commit = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 0

    overlay = read(output)

    Draft202012Validator(read(OVERLAY_SCHEMA)).validate(overlay)
    assert overlay["commit"] == commit
    assert overlay["modified"] is False
    assert overlay["producer"]["name"] == "mutate"
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


def test_a_function_without_crap_coverage_is_absent_everywhere(tmp_path):
    root, _ = mutate_repository(tmp_path)
    overlay_path = root / CRAP
    crap = read(overlay_path)
    del crap["values"]["coverage"]["app/rules.py::both"]
    crap["values"]["coverage"]["app/rules.py::ghost"] = 1.0
    overlay_path.write_text(json.dumps(crap))
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 0

    overlay = read(output)

    for name in ("killed", "survived", "uncovered", "score"):
        assert "app/rules.py::both" not in overlay["values"][name]
        assert "app/rules.py::ghost" not in overlay["values"][name]

    assert row(overlay, "app/rules.py::grade") == [0, 2, 0, 0.0]


@pytest.mark.parametrize(
    "command", [["python3", "-c", "raise SystemExit(1)"], ["/no/such/program"]]
)
def test_a_failing_or_unstartable_baseline_is_exit_two_and_writes_nothing(
    tmp_path, capsys, command
):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    settings = json.dumps({"test_command": command})

    assert run_mutate(root, output, settings) == 2
    assert "baseline test run failed" in capsys.readouterr().err
    assert not output.exists()
    assert not (root / SURVIVORS).exists()
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()


def test_the_baseline_failure_shows_the_tail_of_its_output(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    script = "import sys; print('\\n'.join(str(i) for i in range(40))); sys.exit(3)"
    settings = json.dumps({"test_command": ["python3", "-c", script]})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2

    err = capsys.readouterr().err

    assert "(exit 3)" in err
    assert "39" in err
    assert "\n19\n" not in err


def stale_crap(root, mutation):
    path = root / CRAP
    document = read(path)
    mutation(document)
    path.write_text(json.dumps(document))


@pytest.mark.parametrize(
    "mutation",
    [
        lambda d: d.update(commit="other"),
        lambda d: d["metrics"].pop(1),
        lambda d: d["values"].pop("coverage"),
    ],
    ids=["other-commit", "no-coverage-metric", "no-coverage-values"],
)
def test_a_stale_or_incomplete_crap_overlay_is_exit_two(tmp_path, capsys, mutation):
    root, _ = mutate_repository(tmp_path)
    stale_crap(root, mutation)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 2
    assert "recognizer scan --sense crap" in capsys.readouterr().err
    assert not output.exists()
    assert not (root / SURVIVORS).exists()


def test_a_missing_crap_overlay_is_exit_two(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    (root / CRAP).unlink()

    assert run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/weak.py")) == 2
    assert CRAP in capsys.readouterr().err


def test_an_unreadable_lcov_file_is_exit_two(tmp_path):
    root, _ = mutate_repository(tmp_path)
    (root / "coverage" / "lcov.info").unlink()
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 2
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
        {},
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
        {"test_command": ["t"], "crap_overlay": "../crap.json"},
        {"test_command": ["t"], "survivors": ""},
        {"test_command": ["t"], "nope": 1},
    ],
)
def test_bad_settings_are_rejected(raw):
    with pytest.raises(SettingsError):
        measurer.parse_settings(raw)


def test_bad_settings_exit_two_through_the_cli(tmp_path):
    root, _ = mutate_repository(tmp_path)

    assert run_mutate(root, tmp_path / "overlay.json", "{}") == 2


def test_settings_defaults():
    settings = measurer.parse_settings({"test_command": ["t"]})

    assert settings == {
        "test_command": ["t"],
        "timeout_factor": 10.0,
        "max_workers": os.cpu_count() or 1,
        "coverage": "coverage/lcov.info",
        "crap_overlay": ".recognizer/cache/overlays/crap.json",
        "survivors": ".recognizer/cache/mutation/survivors.json",
        "record": ".recognizer/cache/mutation/record.json",
        "incremental": True,
        "max_minutes": None,
    }


def test_the_timeout_has_a_two_second_floor():
    assert measurer.timeout_for(0.05, 10) == 2.0
    assert measurer.timeout_for(1.0, 10) == 10.0


def test_the_metric_list_equals_the_shared_file():
    assert json.loads(MEASURERS_FILE.read_text()) == {"mutate": measurer.METRICS}


def test_a_dirty_tree_is_recorded_as_modified(tmp_path):
    root, _ = mutate_repository(tmp_path)
    (root / "app" / "rules.py").write_text((root / "app" / "rules.py").read_text() + "\n")
    output = tmp_path / "overlay.json"

    run_mutate(root, output, mutate_settings("tests/weak.py"))

    assert read(output)["modified"] is True


def test_the_overlay_goes_to_stdout_without_output(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)

    assert (
        main(
            ["mutate", "--repository", str(root), "--settings", mutate_settings("tests/strong.py")]
        )
        == 0
    )
    assert json.loads(capsys.readouterr().out)["producer"]["name"] == "mutate"


def covered_target(start_line, end_line):
    return measurer.Target("id", "module", "f.py", "f", start_line, end_line)


def site_at(line, start_byte=0, end_byte=1):
    return measurer.Site(line, 0, start_byte, end_byte, "==", "!=")


def test_a_site_on_a_continuation_line_takes_the_preceding_instrumented_line():
    target = covered_target(10, 20)

    assert measurer.site_is_covered(site_at(13), target, {11: 4, 15: 0}) is True
    assert measurer.site_is_covered(site_at(16), target, {11: 4, 15: 0}) is False


def test_a_site_before_any_instrumented_line_in_its_function_is_uncovered():
    target = covered_target(10, 20)

    assert measurer.site_is_covered(site_at(11), target, {5: 3, 14: 3}) is False
    assert measurer.site_is_covered(site_at(11), target, {}) is False


def test_a_site_in_a_nested_unit_function_belongs_to_the_nested_function():
    sites = [site_at(3, 30, 32), site_at(8, 80, 82)]
    spans = [(0, 200), (50, 120)]

    owned = measurer.innermost(sites, spans)

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
        return json.dumps({"test_command": [sys.executable, str(script), test], **extra})

    def runs():
        return len(log.read_text().splitlines()) if log.exists() else 0

    return settings, runs


def summary(capsys):
    lines = [
        line
        for line in capsys.readouterr().err.splitlines()
        if line.startswith("recognizer-sensors: mutate: ") and "functions reused" in line
    ]

    assert len(lines) == 1

    return lines[0].removeprefix("recognizer-sensors: mutate: ")


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

    assert record["record_version"] == 1
    assert record["skipped"] == []
    assert record["functions"]["app/rules.py::grade"]["verdicts"] == ["killed", "killed"]
    assert record["functions"]["app/rules.py::total"]["verdicts"] == [None]

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys) == (
        "3 of 3 functions reused, 0 mutated, 0 skipped (uncovered-by-budget)"
    )
    assert runs() == after_first
    assert read(output)["values"] == first_overlay["values"]

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
        lambda path: path.write_text(json.dumps({**read(path), "record_version": 2})),
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
        "SF:app/rules.py\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,0\nDA:5,0\nDA:6,0\nDA:9,1\nDA:10,1\nend_of_record\n"
    )

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys) == (
        "2 of 3 functions reused, 1 mutated, 0 skipped (uncovered-by-budget)"
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
    ("change", "path"),
    [
        (edit_test, "tests/strong.py"),
        (add_untracked_test, "tests/extra.py"),
        (delete_test, "tests/weak.py"),
        (edit_conftest, "conftest.py"),
    ],
    ids=["edited", "untracked", "deleted", "conftest"],
)
def test_a_changed_test_file_forces_a_full_run(tmp_path, counting, capsys, change, path):
    settings, runs = counting
    root, commit, output, after_first = first_run(tmp_path, counting, capsys)
    change(root)

    assert run_mutate(root, output, settings(max_workers=1)) == 0

    err = capsys.readouterr().err

    assert (
        f"recognizer-sensors: mutate: test files changed since {commit[:12]} ({path}); "
        "running every function"
    ) in err
    assert "0 of 3 functions reused, 3 mutated" in err
    assert err.index("test files changed") < err.index("functions reused")
    assert read(root / RECORD)["commit"] == commit


def test_a_committed_test_change_triggers_the_full_run(tmp_path, counting, capsys):
    settings, _ = counting
    root, commit, output, _ = first_run(tmp_path, counting, capsys)
    edit_test(root)
    git(root, "add", "tests/strong.py")
    git(root, "commit", "-q", "-m", "edit")

    assert run_mutate(root, output, settings(max_workers=1), "--commit", commit) == 0

    err = capsys.readouterr().err

    assert "test files changed since" in err
    assert "0 of 3 functions reused" in err


def test_a_record_whose_commit_is_unknown_cannot_be_compared(tmp_path, counting, capsys):
    settings, _ = counting
    root, _, output, _ = first_run(tmp_path, counting, capsys)
    record = read(root / RECORD)
    record["commit"] = "0" * 40
    (root / RECORD).write_text(json.dumps(record))

    assert run_mutate(root, output, settings(max_workers=1)) == 0

    err = capsys.readouterr().err

    assert f"cannot compare with {'0' * 12}; running every function" in err
    assert "0 of 3 functions reused" in err


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


def test_no_deadline_runs_every_function():
    assert runner.run_functions(["a", "b"], lambda i: [i], 1, None, Ticker()) == [["a"], ["b"]]


def test_a_budgeted_run_skips_what_it_could_not_start_and_the_next_run_resumes(
    tmp_path, counting, capsys, monkeypatch
):
    settings, _ = counting
    root, commit = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    ticks = iter([0.0, 0.0])
    monkeypatch.setattr(measurer, "CLOCK", lambda: next(ticks, 1000.0))

    assert run_mutate(root, output, settings(max_workers=1, max_minutes=1)) == 0
    assert summary(capsys) == (
        "0 of 3 functions reused, 2 mutated, 1 skipped (uncovered-by-budget)"
    )

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

    monkeypatch.setattr(measurer, "CLOCK", time.monotonic)

    assert run_mutate(root, output, settings(max_workers=1)) == 0
    assert summary(capsys) == (
        "2 of 3 functions reused, 1 mutated, 0 skipped (uncovered-by-budget)"
    )
    assert row(read(output), "app/rules.py::grade") == [2, 0, 0, 1.0]
    assert read(root / SURVIVORS)["complete"] is True
    assert read(root / RECORD)["skipped"] == []


def test_skipped_functions_are_queued_first():
    pending = [
        measurer.Target("a", "m", "f", "a", 1, 2),
        measurer.Target("b", "m", "f", "b", 1, 2),
        measurer.Target("c", "m", "f", "c", 1, 2),
    ]

    assert [t.identity for t in measurer.queue_order(pending, ["c"])] == ["c", "a", "b"]


def test_a_timed_out_mutant_is_a_kill_named_in_timeouts_and_not_a_survivor(tmp_path):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/slow_on_mutant.py")) == 0

    survivors = read(root / SURVIVORS)
    grade = survivors["functions"]["app/rules.py::grade"]

    assert grade["timeouts"] == [{"line": 2, "operator": ">=", "replacement": ">"}]
    assert len(grade["survivors"]) == 1
    assert row(read(output), "app/rules.py::grade") == [1, 1, 0, 0.5]
    assert sensor.counts_agree(read(output), survivors)
    assert read(root / RECORD)["functions"]["app/rules.py::grade"]["verdicts"] == [
        "timeout",
        "survived",
    ]


@pytest.mark.parametrize("bad", [0, -1, True, "5"])
def test_a_bad_max_minutes_is_rejected(bad):
    with pytest.raises(SettingsError):
        measurer.parse_settings({"test_command": ["t"], "max_minutes": bad})


@pytest.mark.parametrize("bad", [1, "yes", None])
def test_a_non_boolean_incremental_is_rejected(bad):
    with pytest.raises(SettingsError):
        measurer.parse_settings({"test_command": ["t"], "incremental": bad})


def test_the_new_settings_are_accepted():
    settings = measurer.parse_settings(
        {"test_command": ["t"], "max_minutes": 2, "incremental": False, "record": "r/x.json"}
    )

    assert settings["max_minutes"] == 2.0
    assert settings["incremental"] is False
    assert settings["record"] == "r/x.json"
