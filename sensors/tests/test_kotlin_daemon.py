import os
import shlex
import signal
import subprocess
import sys
import textwrap
import time

import pytest
from conftest import mutate_repository
from test_mutation import run_mutate
from test_mutation_memory import FakeSampler, kotlin_suite, sized_run
from test_mutation_stop import start_child

from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.mutation.memory import default_workers
from recognizer_sensors.mutation.runner import (
    GradleHomes,
    PeakSampler,
    daemon_pids,
    gradle_homes,
    process_is_alive,
    remove_stale_work_folders,
    run_test_command,
)
from recognizer_sensors.testrun.suites import Suite

MB = 1_000_000

FAKE_GRADLEW = """#!/bin/sh
if [ "$1" = "--stop" ]; then
  echo "$GRADLE_USER_HOME" >> "$STOP_LOG"
  if [ -z "$KEEP_DAEMONS" ]; then
    for f in "$GRADLE_USER_HOME"/daemon/9/daemon-*.out.log; do
      [ -e "$f" ] || continue
      n=${f##*daemon-}
      n=${n%.out.log}
      kill "$n"
    done
  fi
  exit 0
fi
echo "$GRADLE_USER_HOME" >> "$RUN_LOG"
mkdir -p "$GRADLE_USER_HOME/daemon/9"
PYTHON -c "import time; time.sleep(300)" GradleDaemon </dev/null >/dev/null 2>&1 &
pid=$!
i=0
while [ $i -lt 400 ]; do
  case "$(ps -ww -o command= -p "$pid" 2>/dev/null)" in
    *GradleDaemon*) break ;;
  esac
  i=$((i + 1))
  sleep 0.05
done
touch "$GRADLE_USER_HOME/daemon/9/daemon-$pid.out.log"
exit 0
"""


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")
    runner.STOP.clear()
    runner.BUDGET_SPENT.clear()


class Fake:
    def __init__(self, tmp_path, keep=False):
        self.script = tmp_path / "gradlew"
        self.script.write_text(FAKE_GRADLEW.replace("PYTHON", shlex.quote(sys.executable)))
        self.script.chmod(0o755)
        self.stop_log = tmp_path / "stop.log"
        self.run_log = tmp_path / "run.log"
        self.stop_log.touch()
        self.run_log.touch()
        env = {"STOP_LOG": str(self.stop_log), "RUN_LOG": str(self.run_log)}

        if keep:
            env["KEEP_DAEMONS"] = "1"

        self.env = env
        self.suite = Suite("k", "kotlin", ".", f"{self.script} test", None, env, "c", "lcov", None)

    def start(self, home, repository):
        done = subprocess.run(
            [str(self.script), "test"],
            cwd=repository,
            env={**os.environ, **self.env, "GRADLE_USER_HOME": str(home)},
            check=True,
        )

        assert done.returncode == 0

    def stopped(self):
        return self.stop_log.read_text().split()


def wait_dead(pids):
    deadline = time.monotonic() + 5

    while time.monotonic() < deadline:
        if not any(process_is_alive(pid) for pid in pids):
            return True

        time.sleep(0.05)

    return False


def diagnosis(paths):
    table = subprocess.run(
        ["ps", "-wweo", "pid,ppid,stat,args"], capture_output=True, text=True, check=False
    ).stdout
    rows = [row for row in table.splitlines() if "Gradle" in row or "time.sleep" in row]
    logs = [str(log) for path in paths for log in path.glob("daemon/*/*")]

    return f"ps={rows} logs={logs}"


def two_daemons(fake, homes, repository):
    paths = [homes.home_for(number, fake.suite, repository) for number in (0, 1)]

    for path in paths:
        fake.start(path, repository)

    pids = [pid for path in paths for pid in daemon_pids(path)]

    assert len(pids) == 2, diagnosis(paths)

    return paths, pids


def test_a_worker_run_gets_its_own_home_and_the_daemon_options(tmp_path):
    source = tmp_path / "source"
    (source / "caches" / "modules-2").mkdir(parents=True)
    home = tmp_path / "home"
    home.mkdir()
    suite = kotlin_suite({"GRADLE_USER_HOME": str(source)})

    result = run_test_command(
        'echo "$GRADLE_USER_HOME $GRADLE_RO_DEP_CACHE $GRADLE_OPTS"',
        tmp_path,
        30,
        suite,
        gradle_home=home,
    )

    assert str(home) in result.output
    assert str(source / "caches") in result.output
    assert "-Dorg.gradle.daemon=true" in result.output
    assert "-Dorg.gradle.daemon.idletimeout=300000" in result.output
    assert "-Dorg.gradle.daemon=false" not in result.output


def test_a_worker_home_is_seeded_from_the_source_home(tmp_path):
    source = tmp_path / "source"
    (source / "wrapper").mkdir(parents=True)
    (source / "init.d").mkdir()
    (source / "init.d" / "a.gradle").write_text("x")
    (source / "gradle.properties").write_text("org.gradle.jvmargs=-Xmx1g")
    suite = kotlin_suite({"GRADLE_USER_HOME": str(source)})

    home = GradleHomes(tmp_path / "work").home_for(0, suite)

    assert (home / "wrapper").is_symlink()
    assert (home / "wrapper").resolve() == (source / "wrapper").resolve()
    assert (home / "gradle.properties").read_text() == "org.gradle.jvmargs=-Xmx1g"
    assert (home / "init.d" / "a.gradle").read_text() == "x"

    empty = tmp_path / "empty"
    empty.mkdir()
    bare = GradleHomes(tmp_path / "bare").home_for(
        0, kotlin_suite({"GRADLE_USER_HOME": str(empty)})
    )

    assert sorted(path.name for path in bare.iterdir()) == []


def test_a_normal_finish_stops_every_workers_daemon(tmp_path):
    fake = Fake(tmp_path)
    work = tmp_path / "work"
    work.mkdir()

    with gradle_homes(work) as homes:
        paths, pids = two_daemons(fake, homes, tmp_path)

    assert wait_dead(pids)
    assert sorted(fake.stopped()) == sorted(str(path) for path in paths)


def test_a_sensor_error_stops_every_workers_daemon(tmp_path):
    fake = Fake(tmp_path)
    work = tmp_path / "work"
    work.mkdir()

    with pytest.raises(sensor.MeasurementError), gradle_homes(work) as homes:
        paths, pids = two_daemons(fake, homes, tmp_path)

        raise sensor.MeasurementError("boom")

    assert wait_dead(pids)
    assert sorted(fake.stopped()) == sorted(str(path) for path in paths)


def test_command_of_reads_a_command_line_wider_than_the_terminal(monkeypatch):
    monkeypatch.setenv("COLUMNS", "40")
    padding = "x" * 120
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)", padding, "GradleDaemon"]
    )

    try:
        assert "GradleDaemon" in runner.command_of(process.pid)
    finally:
        process.kill()
        process.wait()


def daemon_child(fake, tmp_path, tail):
    return textwrap.dedent(
        f"""
        import os, subprocess, sys, time
        from pathlib import Path
        from recognizer_sensors.mutation import runner
        from recognizer_sensors.testrun.suites import Suite

        base = Path(sys.argv[1])
        work = base / "work"
        work.mkdir(exist_ok=True)
        suite = Suite("k", "kotlin", ".", {str(fake.script) + " test"!r}, None, {fake.env!r}, "c", "lcov", None)

        with runner.gradle_homes(work) as homes:
            pids = []

            for number in (0, 1):
                home = homes.home_for(number, suite, base)
                subprocess.run(
                    [{str(fake.script)!r}, "test"],
                    cwd=base,
                    env={{**os.environ, **{fake.env!r}, "GRADLE_USER_HOME": str(home)}},
                    check=True,
                )
                pids += runner.daemon_pids(home)

            (base / "pids").write_text(" ".join(map(str, pids)))
            restore = runner.install_stop_handler(work)
            print("ready", flush=True)
            {tail}
        """
    )


UNWIND = """while not runner.STOP.is_set():
                time.sleep(0.05)

            restore()
            time.sleep(0.2)"""

WAIT = """time.sleep(60)"""


def read_pids(tmp_path):
    pids = [int(item) for item in (tmp_path / "pids").read_text().split()]

    assert len(pids) == 2

    return pids


def stop_by(tmp_path, number):
    fake = Fake(tmp_path)
    process = start_child(tmp_path, daemon_child(fake, tmp_path, UNWIND))
    pids = read_pids(tmp_path)

    try:
        os.kill(process.pid, number)
        process.wait(timeout=20)

        assert wait_dead(pids)
        assert len(fake.stopped()) == 2
    finally:
        if process.poll() is None:
            process.kill()


def test_stop_by_sigterm_stops_every_workers_daemon(tmp_path):
    stop_by(tmp_path, signal.SIGTERM)


def test_stop_by_sigint_stops_every_workers_daemon(tmp_path):
    stop_by(tmp_path, signal.SIGINT)


def test_leave_stops_the_daemons_before_removing_the_work_folder(tmp_path):
    fake = Fake(tmp_path)
    process = start_child(tmp_path, daemon_child(fake, tmp_path, WAIT))
    pids = read_pids(tmp_path)

    try:
        os.kill(process.pid, signal.SIGTERM)
        time.sleep(0.3)
        os.kill(process.pid, signal.SIGTERM)

        assert process.wait(timeout=20) == 143
        assert wait_dead(pids)
        assert len(fake.stopped()) == 2
        assert not (tmp_path / "work").exists()
    finally:
        if process.poll() is None:
            process.kill()


def test_the_pid_step_kills_a_daemon_that_ignores_stop(tmp_path):
    fake = Fake(tmp_path, keep=True)
    homes = GradleHomes(tmp_path / "work")
    home = homes.home_for(0, fake.suite, tmp_path)
    fake.start(home, tmp_path)
    pids = daemon_pids(home)

    assert len(pids) == 1

    homes.stop_all()

    assert fake.stopped() == [str(home)]
    assert wait_dead(pids)


def test_a_pid_whose_command_is_not_a_gradle_daemon_is_left_alone(tmp_path):
    homes = GradleHomes(tmp_path / "work")
    home = homes.home_for(0)
    bystander = subprocess.Popen(["sleep", "30"])

    try:
        folder = home / "daemon" / "9"
        folder.mkdir(parents=True)
        (folder / f"daemon-{bystander.pid}.out.log").touch()

        homes.stop_all()

        assert bystander.poll() is None
    finally:
        bystander.kill()
        bystander.wait()


def test_the_next_run_reaps_the_daemons_of_a_stale_work_folder(tmp_path):
    fake = Fake(tmp_path)
    parent = tmp_path / "work"
    own = parent / "own"
    stale = parent / "stale"
    own.mkdir(parents=True)
    stale.mkdir()
    (stale / "pid").write_text("999999999")
    home = GradleHomes(stale).home_for(0, fake.suite, tmp_path)
    fake.start(home, tmp_path)
    pids = daemon_pids(home)

    assert len(pids) == 1

    remove_stale_work_folders(own)

    assert wait_dead(pids)
    assert not stale.exists()


def test_daemon_pids_returns_only_live_gradle_daemons(tmp_path):
    fake = Fake(tmp_path)
    home = GradleHomes(tmp_path / "work").home_for(0, fake.suite, tmp_path)
    fake.start(home, tmp_path)
    [live] = daemon_pids(home)
    bystander = subprocess.Popen(["sleep", "30"])

    try:
        folder = home / "daemon" / "9"
        (folder / "daemon-999999999.out.log").touch()
        (folder / f"daemon-{bystander.pid}.out.log").touch()

        assert daemon_pids(home) == [live]
    finally:
        bystander.kill()
        bystander.wait()
        os.kill(live, signal.SIGKILL)


@pytest.mark.parametrize(
    ("available", "expected"),
    [(8000 * MB, 4), (4000 * MB, 2), (3999 * MB, 1)],
)
def test_default_workers_counts_the_daemon_heap(available, expected):
    assert default_workers(8, available, 1000 * MB, 1000 * MB) == expected
    assert default_workers(8, 4000 * MB, 1000 * MB, 0) == 4


def test_the_sizing_line_names_the_daemon_when_counted(tmp_path, monkeypatch, capsys):
    FakeSampler.daemons = [1000 * MB]
    monkeypatch.setattr(sensor, "probe_peak", lambda *a, **k: (1000 * MB, 1000 * MB))
    root, _ = mutate_repository(tmp_path)
    monkeypatch.setattr(sensor, "available_bytes", lambda: 3_000_000_000)
    monkeypatch.setattr(sensor, "PeakSampler", FakeSampler)
    monkeypatch.setattr(sensor, "core_count", lambda: 8)
    from conftest import mutate_settings

    assert run_mutate(root, tmp_path / "o.json", mutate_settings("tests/weak.py")) == 0

    err = capsys.readouterr().err

    assert "one run 1000 MB, resident daemon 1000 MB, bound by memory" in err
    FakeSampler.daemons = []


def test_the_sizing_line_is_unchanged_without_a_daemon(tmp_path, monkeypatch, capsys):
    _, err = sized_run(tmp_path, monkeypatch, capsys, lambda: 3_000_000_000, 8)

    assert "one run 1000 MB, bound by memory; max_workers sets the count)" in err
    assert "resident daemon" not in err


def test_the_probe_runs_a_kotlin_selected_command_twice_and_stops_its_daemon(tmp_path, monkeypatch):
    fake = Fake(tmp_path)
    repository = tmp_path / "repo"
    repository.mkdir()
    (repository / "f").write_text("x")
    work = tmp_path / "work"
    work.mkdir()
    FakeSampler.peaks = [100 * MB, 300 * MB]
    FakeSampler.daemons = [100 * MB, 300 * MB]
    monkeypatch.setattr(sensor, "PeakSampler", FakeSampler)
    monkeypatch.setattr(sensor, "probe_command", lambda *_: (fake.suite, f"{fake.script} test"))

    result = sensor.probe_peak(repository, work, (), [], {}, 1)

    assert result == (300 * MB, 300 * MB)
    assert len(fake.run_log.read_text().split()) == 2
    assert len(fake.stopped()) == 1
    assert not any(daemon_pids(path) for path in work.glob("gradle-home-*"))
    FakeSampler.peaks = []
    FakeSampler.daemons = []


def test_the_sampler_reports_the_daemons_resident_memory(tmp_path):
    homes = GradleHomes(tmp_path / "work")
    home = homes.home_for(0)
    allocate = (
        "x = bytearray(150_000_000); x[::4096] = b'a' * len(x[::4096]); import time; time.sleep(3)"
    )
    process = subprocess.Popen([sys.executable, "-c", allocate, "GradleDaemon"])

    try:
        folder = home / "daemon" / "9"
        folder.mkdir(parents=True)
        (folder / f"daemon-{process.pid}.out.log").touch()

        with PeakSampler(interval=0.05, homes=[home]) as sampler:
            time.sleep(1.5)

        assert sampler.daemon_bytes >= 120 * MB
        assert sampler.peak_bytes == 0
    finally:
        process.kill()
        process.wait()
