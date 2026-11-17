import os
import shlex
import signal
import subprocess
import sys
import time

import pytest
from test_mutation_memory import kotlin_suite

from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.mutation.runner import (
    GradleHomes,
    daemon_pids,
    gradle_homes,
    process_is_alive,
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
