import subprocess
import sys

import pytest

from recognizer_sensors import backup
from recognizer_sensors.backup import exclude_from_backup


@pytest.fixture
def calls(monkeypatch):
    recorded = []

    def run(command, **kwargs):
        recorded.append(command)

        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(backup.subprocess, "run", run)
    monkeypatch.setattr(sys, "platform", "darwin")

    return recorded


def test_exclude_from_backup_runs_tmutil_addexclusion_once_on_darwin(calls, tmp_path):
    exclude_from_backup(tmp_path)

    assert calls == [["tmutil", "addexclusion", str(tmp_path)]]


def test_exclude_from_backup_runs_nothing_off_darwin(calls, monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")

    exclude_from_backup(tmp_path)

    assert calls == []


@pytest.mark.parametrize(
    "failure",
    [FileNotFoundError("tmutil"), subprocess.TimeoutExpired("tmutil", 1)],
)
def test_exclude_from_backup_swallows_a_missing_or_slow_tmutil(
    failure, monkeypatch, capsys, tmp_path
):
    def run(command, **kwargs):
        raise failure

    monkeypatch.setattr(backup.subprocess, "run", run)
    monkeypatch.setattr(sys, "platform", "darwin")

    exclude_from_backup(tmp_path)

    captured = capsys.readouterr()
    assert captured.out == "" and captured.err == ""


def test_exclude_from_backup_ignores_a_nonzero_exit(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(
        backup.subprocess,
        "run",
        lambda command, **kwargs: subprocess.CompletedProcess(command, 1),
    )
    monkeypatch.setattr(sys, "platform", "darwin")

    exclude_from_backup(tmp_path)

    captured = capsys.readouterr()
    assert captured.out == "" and captured.err == ""


def test_new_work_folder_marks_the_work_parent_each_time_it_is_recreated(monkeypatch, tmp_path):
    from recognizer_sensors.mutation import runner

    marked = []
    monkeypatch.setattr(runner, "exclude_from_backup", marked.append)

    first = runner.new_work_folder(tmp_path)
    runner.remove_work_folder(first)
    second = runner.new_work_folder(tmp_path)

    parent = tmp_path / runner.WORK
    assert marked == [parent, parent]
    assert second.parent == parent


def test_tool_environment_marks_python_env_once_per_path_and_again_after_deletion(
    monkeypatch, tmp_path
):
    from recognizer_sensors.testrun import profiles

    marked = []
    monkeypatch.setattr(profiles, "exclude_from_backup", marked.append)
    (tmp_path / "uv.lock").write_text("")
    environment = tmp_path / profiles.UV_ENVIRONMENT

    profiles.tool_environment(tmp_path)
    profiles.tool_environment(tmp_path)

    assert marked == [environment]
    assert environment.is_dir()

    environment.rmdir()
    profiles.tool_environment(tmp_path)

    assert marked == [environment, environment]


def test_tool_environment_with_mark_false_creates_and_marks_nothing(monkeypatch, tmp_path):
    from recognizer_sensors.testrun import profiles

    marked = []
    monkeypatch.setattr(profiles, "exclude_from_backup", marked.append)
    (tmp_path / "uv.lock").write_text("")

    profiles.tool_environment(tmp_path, mark=False)

    assert marked == []
    assert not (tmp_path / profiles.UV_ENVIRONMENT).exists()


def test_tool_environment_without_a_uv_lock_marks_nothing(monkeypatch, tmp_path):
    from recognizer_sensors.testrun import profiles

    marked = []
    monkeypatch.setattr(profiles, "exclude_from_backup", marked.append)

    assert profiles.tool_environment(tmp_path) is None
    assert marked == []
