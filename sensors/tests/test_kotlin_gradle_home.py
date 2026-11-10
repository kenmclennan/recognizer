import hashlib
import json
import signal
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_kotlin_selection import (
    make,
)

from recognizer_sensors import cli
from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.settings import MeasurementError
from recognizer_sensors.testrun import gradle, memory, profiles
from recognizer_sensors.testrun.run import (
    collect_coverage_with_tests,
)

REAL_CACHE_ROOT = gradle.cache_root


def expected_home(root: Path, base: Path) -> Path:
    resolved = root.resolve()
    key = f"{resolved.name}-{hashlib.sha256(str(resolved).encode()).hexdigest()[:12]}"

    return base / "recognizer" / key / "gradle-home"


def test_the_home_is_under_the_library_caches_folder_on_macos(tmp_path, monkeypatch):
    monkeypatch.setattr(gradle, "cache_root", REAL_CACHE_ROOT)
    monkeypatch.setattr(gradle.sys, "platform", "darwin")
    monkeypatch.setenv("HOME", str(tmp_path / "h"))
    root = tmp_path / "shop"
    root.mkdir()

    assert gradle.gradle_home(root) == expected_home(root, tmp_path / "h" / "Library" / "Caches")


def test_the_home_uses_xdg_cache_home_else_dot_cache_elsewhere(tmp_path, monkeypatch):
    monkeypatch.setattr(gradle, "cache_root", REAL_CACHE_ROOT)
    monkeypatch.setattr(gradle.sys, "platform", "linux")
    monkeypatch.setenv("HOME", str(tmp_path / "h"))
    root = tmp_path / "shop"
    root.mkdir()

    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "x"))
    assert gradle.gradle_home(root) == expected_home(root, tmp_path / "x")

    monkeypatch.setenv("XDG_CACHE_HOME", "")
    assert gradle.gradle_home(root) == expected_home(root, tmp_path / "h" / ".cache")

    monkeypatch.delenv("XDG_CACHE_HOME")
    assert gradle.gradle_home(root) == expected_home(root, tmp_path / "h" / ".cache")


def test_two_repositories_sharing_a_folder_name_get_different_homes(tmp_path):
    (tmp_path / "a" / "shop").mkdir(parents=True)
    (tmp_path / "b" / "shop").mkdir(parents=True)

    first = gradle.gradle_home(tmp_path / "a" / "shop")
    second = gradle.gradle_home(tmp_path / "b" / "shop")

    assert first != second
    assert first.parent.name.startswith("shop-")
    assert second.parent.name.startswith("shop-")


def test_a_symlinked_repository_has_the_key_of_its_resolved_path(tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    (tmp_path / "link").symlink_to(real)

    assert gradle.gradle_home(tmp_path / "link") == gradle.gradle_home(real)


def test_preparing_the_home_sets_a_ten_minute_idle_timeout(tmp_path):
    home = gradle.prepare_home(tmp_path)

    assert (home / "gradle.properties").read_text() == "org.gradle.daemon.idletimeout=600000\n"


def test_a_gradle_command_gets_the_home_and_other_commands_do_not(tmp_path):
    environment = profiles.tool_environment(tmp_path, command=["./gradlew", "test"])

    assert environment["GRADLE_USER_HOME"] == str(gradle.gradle_home(tmp_path))
    assert profiles.tool_environment(tmp_path) is None
    assert profiles.tool_environment(tmp_path, command=["cargo", "test"]) is None


def test_a_user_supplied_test_command_keeps_the_users_environment(tmp_path):
    profiles.USER_COMMANDS.add(("./gradlew", "check"))

    try:
        assert profiles.tool_environment(tmp_path, command=["./gradlew", "check"]) is None
    finally:
        profiles.USER_COMMANDS.clear()


def runs_of(tmp_path):
    return (tmp_path / "log").read_text().splitlines()


def homes_of(tmp_path):
    return set((tmp_path / "homes").read_text().splitlines())


def test_the_coverage_and_per_file_runs_carry_the_home(tmp_path, monkeypatch):
    root, scan = make(tmp_path, monkeypatch=monkeypatch)

    collect_coverage_with_tests(root, [scan], None)

    assert len(runs_of(tmp_path)) == 4
    assert homes_of(tmp_path) == {str(gradle.gradle_home(root))}


def test_the_probe_environment_carries_the_home(tmp_path, monkeypatch):
    from recognizer_sensors.testrun import probes

    root, _ = make(tmp_path, monkeypatch=monkeypatch)

    result = probes.answers(["./gradlew", "--version"], root)

    assert result is not None
    assert homes_of(tmp_path) == {str(gradle.gradle_home(root))}


def test_stopping_runs_gradle_stop_under_the_home_and_a_failure_is_ignored(tmp_path, monkeypatch):
    root, _ = make(tmp_path, monkeypatch=monkeypatch)
    gradle.prepare_home(root)

    gradle.stop_daemons(root)

    assert runs_of(tmp_path) == ["--stop"]
    assert homes_of(tmp_path) == {str(gradle.gradle_home(root))}

    monkeypatch.setenv("FAKE_STOP_FAIL", "1")
    gradle.stop_daemons(root)

    assert runs_of(tmp_path) == ["--stop", "--stop"]


def test_stopping_without_a_wrapper_or_a_home_does_nothing(tmp_path, monkeypatch):
    root, _ = make(tmp_path, monkeypatch=monkeypatch)

    gradle.stop_daemons(root)

    assert not (tmp_path / "log").exists()

    (root / "gradlew").unlink()
    gradle.prepare_home(root)
    gradle.stop_daemons(root)

    assert not (tmp_path / "log").exists()


def test_a_run_that_cannot_start_the_stop_command_still_returns(tmp_path, monkeypatch):
    root, _ = make(tmp_path, monkeypatch=monkeypatch)
    gradle.prepare_home(root)
    (root / "gradlew").write_text("#!/nonexistent/interpreter\n")

    gradle.stop_daemons(root)


@pytest.mark.parametrize("name", ["crap", "mutation"])
def test_a_tests_running_sensor_stops_the_daemons_when_it_ends_or_fails(
    tmp_path, monkeypatch, name
):
    stopped = []
    monkeypatch.setattr(cli, "stop_daemons", lambda repository: stopped.append(repository))
    root, _ = make(tmp_path, monkeypatch=monkeypatch)

    def boom(*_args, **_kwargs):
        raise RuntimeError("sensor failed")

    sensor_entry = cli.SHIPPED[name]

    original = sensor_entry.run
    object.__setattr__(sensor_entry, "run", boom)

    try:
        with pytest.raises(RuntimeError):
            cli.main([name, "--repository", str(root), "--commit", "abc"])
    finally:
        object.__setattr__(sensor_entry, "run", original)

    assert stopped == [root]


def test_the_coverage_stop_signal_stops_the_daemons(tmp_path, monkeypatch):
    stopped = []
    monkeypatch.setattr(runner, "stop_daemons", lambda repository: stopped.append(repository))
    runner.STOP.clear()
    restore = runner.install_coverage_stop_handler(tmp_path)

    try:
        with pytest.raises(runner.StoppedBeforeMutation):
            signal.raise_signal(signal.SIGTERM)
    finally:
        restore()
        runner.STOP.clear()

    assert stopped == [tmp_path]


def test_the_mutation_stop_path_stops_the_daemons_before_exiting(tmp_path, monkeypatch):
    stopped = []
    codes = []
    monkeypatch.setattr(runner, "stop_daemons", lambda repository: stopped.append(repository))
    monkeypatch.setattr(runner.os, "_exit", lambda code: codes.append(code))
    watchdog_started = threading.Event()
    never = threading.Event()

    def park_the_watchdog(_seconds):
        watchdog_started.set()
        never.wait()

    monkeypatch.setattr(runner.time, "sleep", park_the_watchdog)
    work = tmp_path / "work"
    work.mkdir()
    runner.STOP.clear()
    restore = runner.install_stop_handler(work, repository=tmp_path)

    try:
        signal.raise_signal(signal.SIGTERM)
        signal.raise_signal(signal.SIGTERM)
    finally:
        restore()
        runner.STOP.clear()

    assert watchdog_started.wait(5)
    assert stopped == [tmp_path]
    assert codes == [runner.STOPPED_STATUS]


def test_the_default_worker_count_follows_free_memory_for_kotlin():
    gib = 1024**3

    assert memory.kotlin_workers(8, 6 * gib) == 2
    assert memory.kotlin_workers(8, None) == 8
    assert memory.kotlin_workers(8, 1 * gib) == 1
    assert memory.kotlin_workers(2, 64 * gib) == 2


def test_the_memory_readers_parse_sample_text():
    assert memory.parse_meminfo("MemTotal: 10 kB\nMemAvailable:    2048 kB\n") == 2048 * 1024
    assert memory.parse_meminfo("MemTotal: 10 kB\n") is None

    vm_stat = (
        "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"
        "Pages free:                               100.\n"
        "Pages active:                             999.\n"
        "Pages inactive:                           200.\n"
        "Pages speculative:                         50.\n"
    )

    assert memory.parse_vm_stat(vm_stat) == 350 * 16384
    assert memory.parse_vm_stat("nothing") is None


def settings_of(raw):
    return sensor.parse_settings(raw)


def test_an_unset_worker_count_is_marked_default_and_an_explicit_one_is_not():
    assert isinstance(settings_of({})["max_workers"], sensor.DefaultWorkers)
    assert not isinstance(settings_of({"max_workers": 4})["max_workers"], sensor.DefaultWorkers)
    assert json.dumps(settings_of({})["max_workers"]).isdigit()


def run_with_workers(tmp_path, monkeypatch, raw, language):
    seen = {}
    monkeypatch.setattr(sensor, "free_memory", lambda: 6 * 1024**3)
    monkeypatch.setattr(sensor.os, "cpu_count", lambda: 8)

    def stop_early(repository, scans, coverage):
        seen["settings"] = True
        raise MeasurementError("stop")

    monkeypatch.setattr(sensor, "collect_coverage_with_tests", stop_early)
    parsed = sensor.parse_settings(raw)
    captured = {}
    real = sensor.kotlin_workers

    def spy(cores, free):
        captured["workers"] = real(cores, free)

        return captured["workers"]

    monkeypatch.setattr(sensor, "kotlin_workers", spy)

    with pytest.raises(MeasurementError):
        sensor.run(tmp_path, [SimpleNamespace(language=language)], parsed, "abc")

    return captured.get("workers")


def test_kotlin_workers_default_by_memory_and_an_explicit_setting_is_kept(tmp_path, monkeypatch):
    assert run_with_workers(tmp_path, monkeypatch, {}, "kotlin") == 2
    assert run_with_workers(tmp_path, monkeypatch, {"max_workers": 4}, "kotlin") is None
    assert run_with_workers(tmp_path, monkeypatch, {}, "python") is None
