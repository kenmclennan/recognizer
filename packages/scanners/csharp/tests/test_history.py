import ast
import json
import shutil
import time
from pathlib import Path

import pytest
from conftest import FIXTURE_ROOT

from recognizer_scan_csharp import cli, events, history

SOURCE = "class A {}\n"
EXTENSION = ".cs"
SCAN = "scan_with_stats"


class Clock:
    def __init__(self, now: float = 0.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def make_tree(root: Path, count: int) -> Path:
    root.mkdir(parents=True, exist_ok=True)

    for number in range(count):
        (root / f"m{number}{EXTENSION}").write_text(SOURCE)

    return root


def seed(root: Path, runs: list) -> Path:
    path = history.history_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"runs": runs}))

    return path


def reported(capsys) -> list[dict]:
    err = capsys.readouterr().err

    return [
        json.loads(line.removeprefix("recognizer-event "))
        for line in err.splitlines()
        if line.startswith("recognizer-event ")
    ]


def scan_root(root: Path) -> int:
    return cli.main(["run", str(root)])


def stored(root: Path) -> list[dict]:
    return json.loads(history.history_path(root).read_text())["runs"]


def test_no_history_reports_null_once_after_start(tmp_path, capsys):
    root = make_tree(tmp_path / "repo", 3)

    assert scan_root(root) == 0

    kinds = [event["event"] for event in reported(capsys)]

    assert kinds[:2] == ["start", "estimate"]
    assert kinds.count("estimate") == 1
    assert set(kinds[2:]) == {"progress"}


def test_no_history_estimate_is_null(tmp_path, capsys):
    root = make_tree(tmp_path / "repo", 3)
    scan_root(root)

    estimate = [event for event in reported(capsys) if event["event"] == "estimate"]

    assert estimate == [{"event": "estimate", "remaining_ms": None}]


def test_history_reports_the_scaled_estimate(tmp_path, capsys, monkeypatch):
    root = make_tree(tmp_path / "repo", 100)
    seed(root, [{"key": "run", "ms": 4000, "units": 200}])

    assert scan_root(root) == 0

    first = [event for event in reported(capsys) if event["event"] == "estimate"][0]

    assert 0 <= first["remaining_ms"] <= 2000

    seed(root, [{"key": "run", "ms": 4000, "units": 200}])

    for now, wanted in ((0.5, 1500), (2.0, 0), (2.001, None)):
        clock = Clock()
        monkeypatch.setattr(history, "CLOCK", clock)
        progress = events.Progress(root)
        clock.now = now
        progress.start(100)

        estimate = [e for e in reported(capsys) if e["event"] == "estimate"]

        assert estimate == [{"event": "estimate", "remaining_ms": wanted}]


def test_estimate_is_not_repeated_unchanged_and_moves_by_a_second(tmp_path, capsys, monkeypatch):
    root = tmp_path / "repo"
    seed(root, [{"key": "run", "ms": 4000, "units": 200}])
    clock = Clock()
    monkeypatch.setattr(history, "CLOCK", clock)
    progress = events.Progress(root)
    progress.start(1000)
    first = reported(capsys)

    assert first[-1] == {"event": "estimate", "remaining_ms": 20000}

    def estimates_after(now: float) -> list[dict]:
        clock.now = now

        for _ in range(10):
            progress.advance()

        return [e for e in reported(capsys) if e["event"] == "estimate"]

    assert estimates_after(0.0) == []
    assert estimates_after(0.999) == []
    assert estimates_after(1.0) == [{"event": "estimate", "remaining_ms": 19000}]
    assert estimates_after(1.0) == []
    assert estimates_after(25.0) == [{"event": "estimate", "remaining_ms": None}]


def test_a_completed_run_is_recorded_and_a_failed_one_is_not(tmp_path, capsys, monkeypatch):
    root = make_tree(tmp_path / "repo", 3)

    assert scan_root(root) == 0

    runs = stored(root)

    assert len(runs) == 1
    assert runs[0]["key"] == "run"
    assert runs[0]["units"] == 3

    before = history.history_path(root).read_bytes()

    def raises(*args, **kwargs):
        raise RuntimeError("refused")

    monkeypatch.setattr(cli, SCAN, raises)

    with pytest.raises(RuntimeError):
        scan_root(root)

    assert history.history_path(root).read_bytes() == before

    empty = tmp_path / "empty"
    empty.mkdir()
    progress = events.Progress(empty)
    progress.start(0)
    progress.finish()
    progress.complete()

    assert not history.history_path(empty).exists()


def test_history_keeps_the_last_five_runs(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()

    for number in range(1, 7):
        progress = events.Progress(root)
        progress.start(number)
        progress.complete()

    assert [run["units"] for run in stored(root)] == [2, 3, 4, 5, 6]


@pytest.mark.parametrize(
    "content",
    ['{"runs": ', '{"runs": 3}'],
)
def test_an_unreadable_history_reads_as_none_and_is_left_alone(tmp_path, capsys, content):
    root = make_tree(tmp_path / "repo", 3)
    path = history.history_path(root)
    path.parent.mkdir(parents=True)
    path.write_text(content)

    assert scan_root(root) == 0

    estimate = [e for e in reported(capsys) if e["event"] == "estimate"]

    assert estimate == [{"event": "estimate", "remaining_ms": None}]
    assert path.read_text() == content


def test_a_run_entry_with_a_boolean_is_skipped_and_a_valid_sibling_counts(tmp_path):
    root = tmp_path / "repo"
    seed(
        root,
        [
            {"key": "run", "ms": True, "units": 10},
            {"key": "run", "ms": 4000, "units": 200},
        ],
    )

    assert history.read_runs(root) == [{"key": "run", "ms": 4000, "units": 200}]


def test_a_write_that_fails_does_not_fail_the_scan(tmp_path, capsys):
    root = make_tree(tmp_path / "repo", 3)
    (root / ".recognizer").mkdir()
    (root / ".recognizer" / "cache").write_text("in the way")

    assert scan_root(root) == 0

    document = json.loads(capsys.readouterr().out)

    assert document["modules"]


def test_the_cache_folder_ignores_itself(tmp_path):
    root = make_tree(tmp_path / "repo", 2)
    scan_root(root)
    ignore = root / ".recognizer" / "cache" / ".gitignore"

    assert ignore.read_text().strip() == "*"

    ignore.write_text("kept\n")
    scan_root(root)

    assert ignore.read_text() == "kept\n"


def test_history_clock_is_monotonic():
    source = Path(history.__file__).read_text()
    tree = ast.parse(source)
    first = tree.body[next(i for i, n in enumerate(tree.body) if isinstance(n, ast.Assign))]

    assert history.CLOCK is time.monotonic
    assert isinstance(first, ast.Assign)
    assert first.targets[0].id == "CLOCK"
    assert "time.time" not in source
    assert "datetime" not in source
    assert "perf_counter" not in source


def test_a_wall_clock_jump_does_not_change_a_recorded_run_or_the_estimate(
    tmp_path, capsys, monkeypatch
):
    root = tmp_path / "repo"
    seed(root, [{"key": "run", "ms": 4000, "units": 200}])
    clock = Clock()
    monkeypatch.setattr(history, "CLOCK", clock)
    wall = Clock(1_000_000.0)
    monkeypatch.setattr(time, "time", wall)
    progress = events.Progress(root)
    clock.now = 0.5
    wall.now += 8 * 3600
    progress.start(100)

    estimate = [e for e in reported(capsys) if e["event"] == "estimate"]

    assert estimate == [{"event": "estimate", "remaining_ms": 1500}]

    clock.now = 1.0
    wall.now += 8 * 3600
    progress.complete()

    assert stored(root)[-1] == {"key": "run", "ms": 1000, "units": 100}


def test_a_run_over_the_committed_fixture_reports_a_null_estimate_then_records(tmp_path, capsys):
    root = tmp_path / "fixture"
    shutil.copytree(FIXTURE_ROOT, root, ignore=shutil.ignore_patterns(".recognizer"))

    assert scan_root(root) == 0

    seen = reported(capsys)
    estimate = [e for e in seen if e["event"] == "estimate"]
    total = seen[0]["total"]

    assert estimate == [{"event": "estimate", "remaining_ms": None}]
    assert [run["units"] for run in stored(root)] == [total]
