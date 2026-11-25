import json
import os
import time
from collections.abc import Callable
from pathlib import Path
from statistics import median

from recognizer_sensors import events

CLOCK = time.monotonic

KEPT_RUNS = 5
MOVE_MS = 1000


def history_path(repository: Path, name: str) -> Path:
    return repository / ".recognizer" / "cache" / name / "history.json"


def key_of(names) -> str:
    return ",".join(sorted(names))


def valid_run(item: object) -> bool:
    return (
        isinstance(item, dict)
        and isinstance(item.get("key"), str)
        and isinstance(item.get("ms"), int | float)
        and isinstance(item.get("units"), int | float)
        and not isinstance(item.get("ms"), bool)
        and not isinstance(item.get("units"), bool)
    )


def read_all(repository: Path, name: str) -> list[dict] | None:
    try:
        document = json.loads(history_path(repository, name).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError):
        return None

    runs = document.get("runs") if isinstance(document, dict) else None

    if not isinstance(runs, list):
        return None

    return [item for item in runs if valid_run(item)]


def read_runs(repository: Path, name: str, key: str) -> list[dict]:
    return [run for run in read_all(repository, name) or [] if run["key"] == key]


def record_run(repository: Path, name: str, key: str, ms: int, units: int) -> None:
    runs = read_all(repository, name)

    if runs is None:
        return

    runs.append({"key": key, "ms": ms, "units": units})
    kept: list[dict] = []

    for run in runs:
        same = [item for item in kept if item["key"] == run["key"]]

        if len(same) >= KEPT_RUNS:
            kept.remove(same[0])

        kept.append(run)

    path = history_path(repository, name)
    staged = path.with_name(f"{path.name}.{os.getpid()}.tmp")

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        staged.write_text(json.dumps({"runs": kept}, separators=(",", ":")), encoding="utf-8")
        staged.replace(path)
    except OSError:
        staged.unlink(missing_ok=True)


def elapsed_estimate(runs: list[dict], elapsed_ms: float) -> int | None:
    if not runs:
        return None

    middle = median(run["ms"] for run in runs)

    if elapsed_ms > middle:
        return None

    return int(middle - elapsed_ms)


def rate_estimate(runs: list[dict], units_left: int | None) -> int | None:
    if not runs or units_left is None or any(run["units"] <= 0 for run in runs):
        return None

    return int(median(run["ms"] / run["units"] for run in runs) * units_left)


class Tracker:
    def __init__(
        self,
        repository: Path,
        name: str,
        key: str,
        of: int,
        estimator: Callable[[list[dict], float], int | None],
    ) -> None:
        self.repository = repository
        self.name = name
        self.key = key
        self.of = of
        self.index = 0
        self.estimator = estimator
        self.runs = read_runs(repository, name, key)
        self.started = CLOCK()
        self.last: int | None = None
        self.reported = False

    def elapsed_ms(self) -> float:
        return (CLOCK() - self.started) * 1000

    def stage(self, label: str) -> None:
        if self.index >= self.of:
            return

        self.index += 1
        events.stage(label, self.index, self.of)
        self.estimate(force=True)

    def finish_stages(self, label: str) -> None:
        while self.index < self.of:
            self.stage(label)

    def estimate(self, force: bool = False) -> None:
        value = self.estimator(self.runs, self.elapsed_ms())

        if self.reported:
            if value == self.last:
                return

            small = value is not None and self.last is not None
            small = small and abs(value - self.last) < MOVE_MS

            if small and not force:
                return

        self.last = value
        self.reported = True
        events.estimate(value)

    def finish(self, units: int) -> None:
        record_run(self.repository, self.name, self.key, round(self.elapsed_ms()), units)
