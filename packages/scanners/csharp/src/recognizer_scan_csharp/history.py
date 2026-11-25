import json
import os
import time
from pathlib import Path
from statistics import median

CLOCK = time.monotonic

LANGUAGE = "csharp"
KEY = "run"
KEPT_RUNS = 5
MOVE_MS = 1000


def cache_folder(root: Path) -> Path:
    return root / ".recognizer" / "cache"


def history_path(root: Path) -> Path:
    return cache_folder(root) / f"scan-{LANGUAGE}" / "history.json"


def valid_run(item: object) -> bool:
    return (
        isinstance(item, dict)
        and isinstance(item.get("key"), str)
        and isinstance(item.get("ms"), int | float)
        and isinstance(item.get("units"), int | float)
        and not isinstance(item.get("ms"), bool)
        and not isinstance(item.get("units"), bool)
    )


def read_all(root: Path) -> list[dict] | None:
    try:
        document = json.loads(history_path(root).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError):
        return None

    runs = document.get("runs") if isinstance(document, dict) else None

    if not isinstance(runs, list):
        return None

    return [item for item in runs if valid_run(item)]


def read_runs(root: Path) -> list[dict]:
    return [run for run in read_all(root) or [] if run["key"] == KEY]


def ensure_cache_ignore(root: Path) -> None:
    folder = cache_folder(root)
    folder.mkdir(parents=True, exist_ok=True)

    try:
        with open(folder / ".gitignore", "x", encoding="utf-8") as handle:
            handle.write("*\n")
    except FileExistsError:
        pass


def record_run(root: Path, ms: int, units: int) -> None:
    runs = read_all(root)

    if runs is None:
        return

    runs.append({"key": KEY, "ms": ms, "units": units})
    path = history_path(root)
    staged = path.with_name(f"{path.name}.{os.getpid()}.tmp")

    try:
        ensure_cache_ignore(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        staged.write_text(
            json.dumps({"runs": runs[-KEPT_RUNS:]}, separators=(",", ":")), encoding="utf-8"
        )
        staged.replace(path)
    except OSError:
        staged.unlink(missing_ok=True)


def scaled_estimate(runs: list[dict], total: int, elapsed_ms: float) -> int | None:
    rates = [run["ms"] / run["units"] for run in runs if run["units"] > 0]

    if not rates or total <= 0:
        return None

    projected = median(rates) * total

    if elapsed_ms > projected:
        return None

    return int(projected - elapsed_ms)
