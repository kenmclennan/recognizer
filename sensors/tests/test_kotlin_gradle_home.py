import hashlib
from pathlib import Path

import pytest
from test_kotlin_selection import (
    make,
)

from recognizer_sensors import cli
from recognizer_sensors.testrun import gradle, profiles
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
