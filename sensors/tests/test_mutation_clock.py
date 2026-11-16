import sys

from recognizer_sensors.mutation import runner
from recognizer_sensors.mutation.sensor import timeout_for

HOURS_8 = 8 * 3600.0


class StubClock:
    def __init__(self, *readings):
        self.readings = list(readings)
        self.last = readings[-1]

    def __call__(self):
        if self.readings:
            self.last = self.readings.pop(0)

        return self.last


def test_timeout_ignores_a_sleep_gap(tmp_path, monkeypatch):
    stub = StubClock(100.0, 100.0 + HOURS_8)
    monkeypatch.setattr(runner.time, "monotonic", stub)

    result = runner.run_test_command(
        [sys.executable, "-c", "import time; time.sleep(0.3)"],
        tmp_path,
        timeout=timeout_for(0.1, 10),
    )

    assert result.exit_code == 0
    assert result.timed_out is False


def test_baseline_ignores_a_sleep_gap(tmp_path, monkeypatch):
    stub = StubClock(100.0, 107.5)
    monkeypatch.setattr(runner.time, "monotonic", stub)

    result = runner.run_test_command([sys.executable, "-c", "pass"], tmp_path, timeout=30)

    assert result.seconds == 7.5


def test_budget_deadline_counts_awake_minutes():
    started = 1000.0
    budget_minutes = 10
    deadline = started + budget_minutes * 60
    awake = StubClock(started + 59.0)
    ran = []

    def run_item(item):
        ran.append(item)

        return [item]

    first = runner.run_functions(["a", "b"], run_item, 1, deadline, awake)

    assert first == [["a"], ["b"]]
    assert ran == ["a", "b"]

    spent = StubClock(deadline)
    second = runner.run_functions(["c"], run_item, 1, deadline, spent)

    assert second == [None]
    assert ran == ["a", "b"]
