import json

from recognizer_sensors import history
from recognizer_sensors.history import (
    Tracker,
    elapsed_estimate,
    rate_estimate,
    read_runs,
    record_run,
)

HOUR = 3_600_000


def run_of(ms, units=10, key="a"):
    return {"key": key, "ms": ms, "units": units}


def test_no_history_reports_none(tmp_path):
    assert read_runs(tmp_path, "crap", "a") == []
    assert elapsed_estimate([], 0) is None
    assert rate_estimate([], 10) is None


def test_a_stopped_run_is_not_recorded(tmp_path, monkeypatch):
    ticks = iter([0.0, 5.0])
    monkeypatch.setattr(history, "CLOCK", lambda: next(ticks))
    Tracker(tmp_path, "crap", "a", 1, elapsed_estimate)

    assert read_runs(tmp_path, "crap", "a") == []
    assert not history.history_path(tmp_path, "crap").exists()


def test_a_failed_run_is_not_recorded(tmp_path):
    Tracker(tmp_path, "mutation", "a", 2, elapsed_estimate)

    assert not history.history_path(tmp_path, "mutation").exists()


def test_a_finished_run_is_recorded_on_the_sensors_clock(tmp_path, monkeypatch):
    ticks = iter([10.0, 12.5])
    monkeypatch.setattr(history, "CLOCK", lambda: next(ticks))
    Tracker(tmp_path, "crap", "a", 1, elapsed_estimate).finish(7)

    assert read_runs(tmp_path, "crap", "a") == [{"key": "a", "ms": 2500, "units": 7}]


def test_history_keeps_the_last_five_runs_per_key(tmp_path):
    for ms in range(1, 8):
        record_run(tmp_path, "crap", "a", ms, 1)

    assert [run["ms"] for run in read_runs(tmp_path, "crap", "a")] == [3, 4, 5, 6, 7]


def test_a_run_with_another_suite_selection_does_not_count(tmp_path):
    record_run(tmp_path, "crap", "a", 100, 1)
    record_run(tmp_path, "crap", "b", 900, 1)

    assert [run["ms"] for run in read_runs(tmp_path, "crap", "a")] == [100]
    assert [run["ms"] for run in read_runs(tmp_path, "crap", "b")] == [900]


def test_an_unreadable_history_reads_empty_and_is_left_alone(tmp_path):
    path = history.history_path(tmp_path, "crap")
    path.parent.mkdir(parents=True)
    path.write_text("{not json", encoding="utf-8")

    assert read_runs(tmp_path, "crap", "a") == []

    record_run(tmp_path, "crap", "a", 1, 1)

    assert path.read_text(encoding="utf-8") == "{not json"


def test_elapsed_estimate_reports_none_once_past_the_median():
    runs = [run_of(1000), run_of(2000), run_of(3000)]

    assert elapsed_estimate(runs, 2000) == 0
    assert elapsed_estimate(runs, 2001) is None
    assert elapsed_estimate(runs, 500) == 1500


def test_rate_estimate_spans_a_stage_boundary(tmp_path, monkeypatch):
    record_run(tmp_path, "mutation", "a", 3 * HOUR, 1000)
    runs = read_runs(tmp_path, "mutation", "a")
    left = {"count": 1000}
    tracker = Tracker(tmp_path, "mutation", "a", 2, lambda r, _: rate_estimate(r, left["count"]))
    events_seen = []
    monkeypatch.setattr(history.events, "emit", events_seen.append)
    tracker.stage("one")
    left["count"] = 500
    tracker.stage("two")

    estimates = [e["remaining_ms"] for e in events_seen if e["event"] == "estimate"]

    assert rate_estimate(runs, 500) == 90 * 60 * 1000
    assert estimates == [3 * HOUR, 90 * 60 * 1000]
    assert min(estimates) >= 60_000


def test_rate_estimate_is_none_for_a_recorded_run_with_no_units():
    assert rate_estimate([run_of(1000, units=0)], 10) is None
    assert rate_estimate([run_of(1000), run_of(1000, units=0)], 10) is None


def test_a_history_file_holds_only_runs(tmp_path):
    record_run(tmp_path, "crap", "a", 1, 1)

    document = json.loads(history.history_path(tmp_path, "crap").read_text())

    assert document == {"runs": [{"key": "a", "ms": 1, "units": 1}]}
