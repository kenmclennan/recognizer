import hashlib
import json
import signal
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_kotlin_selection import (
    ALL_CLASSES,
    SOURCES,
    make,
)

from recognizer_sensors import cli
from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.settings import MeasurementError
from recognizer_sensors.testrun import gradle, memory, profiles
from recognizer_sensors.testrun.contexts import ContextSelection
from recognizer_sensors.testrun.kotlin_store import STORE_DIRECTORY, KotlinStore, write_store
from recognizer_sensors.testrun.run import (
    collect_coverage_with_tests,
    kotlin_class_map,
    suite_size,
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


def test_a_class_map_includes_java_test_classes(tmp_path, monkeypatch):
    files = {
        **SOURCES,
        "src/test/java/p/JTest.java": "package p;\n\npublic class JTest {\n}\n",
    }
    root, _ = make(tmp_path, files=files, classes=ALL_CLASSES + " p.JTest", monkeypatch=monkeypatch)
    import subprocess

    subprocess.run([str(root / "gradlew")], cwd=root, check=True)

    mapped = kotlin_class_map(root)

    assert mapped["src/test/java/p/JTest.java"] == [("", "p.JTest")]


def test_one_class_name_in_two_gradle_projects_maps_to_two_files(tmp_path, monkeypatch):
    files = {
        "a/src/test/kotlin/p/XTest.kt": "package p\n\nclass XTest\n",
        "b/src/test/kotlin/p/XTest.kt": "package p\n\nclass XTest\n",
    }
    root, _ = make(tmp_path, files=files, monkeypatch=monkeypatch)

    for project in ("a", "b"):
        results = root / project / "build/test-results/test"
        results.mkdir(parents=True)
        (results / "TEST-p.XTest.xml").write_text("")

    assert kotlin_class_map(root) == {
        "a/src/test/kotlin/p/XTest.kt": [(":a", "p.XTest")],
        "b/src/test/kotlin/p/XTest.kt": [(":b", "p.XTest")],
    }


def test_a_class_declared_by_two_files_of_one_project_still_has_no_single_file(
    tmp_path, monkeypatch
):
    files = {
        "a/src/test/kotlin/p/XTest.kt": "package p\n\nclass XTest\n",
        "a/src/test/kotlin/q/XTest.kt": "package p\n\nclass XTest\n",
    }
    root, _ = make(tmp_path, files=files, monkeypatch=monkeypatch)
    results = root / "a/build/test-results/test"
    results.mkdir(parents=True)
    (results / "TEST-p.XTest.xml").write_text("")

    assert kotlin_class_map(root) == "p.XTest"


def synthetic(tests: int) -> dict:
    names = [f"t/T{n}Test.kt" for n in range(tests)]

    return {
        "m/A.kt": {line: set(names[line % 2 :: 2]) for line in range(1, 40)},
        "m/B.kt": {line: set(names) for line in range(1, 20)},
    }


def test_the_store_file_count_does_not_grow_with_the_test_files(tmp_path):
    small = tmp_path / "small"
    large = tmp_path / "large"
    small.mkdir()
    large.mkdir()

    write_store(small, synthetic(4))
    write_store(large, synthetic(8))

    def count(root):
        return len(list((root / STORE_DIRECTORY).iterdir()))

    assert count(small) == count(large) == 3


def test_a_record_stores_equal_index_lists_once(tmp_path):
    write_store(tmp_path, synthetic(8))
    folder = tmp_path / STORE_DIRECTORY
    record = next(
        json.loads(p.read_text())
        for p in folder.glob("*.json")
        if p.name != "tests.json" and json.loads(p.read_text())["path"] == "m/B.kt"
    )

    assert len(record["sets"]) == 1
    assert len(record["lines"]) == 19
    assert "t/T0Test.kt" not in json.dumps(record)


def test_a_get_reads_one_record_and_the_suite_size_reads_none(tmp_path):
    store = write_store(tmp_path, synthetic(6))
    fresh = KotlinStore(tmp_path)

    assert fresh.suite_files == store.suite_files
    assert len(fresh.suite_files) == 6
    assert fresh.reads == 0

    lines = fresh["m/B.kt"]
    fresh["m/B.kt"]

    assert fresh.reads == 1
    assert lines[3] == frozenset(f"t/T{n}Test.kt" for n in range(6))

    with pytest.raises(KeyError):
        fresh["missing.kt"]


def test_the_selection_merges_the_store_with_eager_selections(tmp_path):
    store = write_store(tmp_path, synthetic(4))
    selection = ContextSelection({"x.ts": {1: frozenset({"x.test.ts"})}}, None, [store])

    assert selection.get("m/A.kt") == store["m/A.kt"]
    assert selection.get("x.ts") == {1: frozenset({"x.test.ts"})}
    assert selection.get("nope") is None
    assert sorted(selection) == ["m/A.kt", "m/B.kt", "x.ts"]
    assert suite_size(selection) == 5


def test_both_steps_failing_leaves_the_whole_suite_message(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_FAIL", "1")
    root, scan = make(tmp_path, monkeypatch=monkeypatch)

    _, selection = collect_coverage_with_tests(root, [scan], None)

    assert selection == {}
    assert "running the whole suite for kotlin" in capsys.readouterr().err
