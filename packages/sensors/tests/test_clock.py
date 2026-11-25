import ast
import inspect
import sys
import time

import pytest

from recognizer_sensors import history
from recognizer_sensors.history import Tracker, elapsed_estimate, read_runs
from recognizer_sensors.mutation import runner, sensor


@pytest.mark.skipif(sys.platform != "darwin", reason="the uptime clock is a macOS fact")
def test_monotonic_is_the_uptime_clock_on_macos():
    assert time.get_clock_info("monotonic").implementation == "mach_absolute_time()"


def test_sensor_clocks_are_time_monotonic():
    assert sensor.CLOCK is time.monotonic
    assert history.CLOCK is time.monotonic
    assert inspect.signature(runner.run_function).parameters["clock"].default is time.monotonic


def test_history_path_reads_no_wall_clock():
    source = inspect.getsource(history)
    tree = ast.parse(source)
    defined = [
        target.id
        for node in tree.body
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    ]

    assert defined[0] == "CLOCK"

    for forbidden in ("time.time", "datetime", "time.perf_counter"):
        assert forbidden not in source


def test_a_wall_clock_jump_does_not_change_a_recorded_run_or_the_estimate(tmp_path, monkeypatch):
    def run(jump):
        root = tmp_path / ("jump" if jump else "still")
        now = {"value": 100.0}
        wall = {"value": 1_000_000.0}
        monkeypatch.setattr(history, "CLOCK", lambda: now["value"])
        monkeypatch.setattr(time, "time", lambda: wall["value"])
        history.record_run(root, "crap", "a", 3000, 1)
        tracker = Tracker(root, "crap", "a", 1, elapsed_estimate)
        now["value"] += 1.0

        if jump:
            wall["value"] += 8 * 3600

        estimate = elapsed_estimate(tracker.runs, tracker.elapsed_ms())
        tracker.finish(1)

        return estimate, read_runs(root, "crap", "a")[-1]["ms"]

    assert run(True) == run(False) == (2000, 1000)
