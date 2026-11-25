import json
import sys
from pathlib import Path

from . import history

PREFIX = "recognizer-event "

UNIT = "files"

MAX_PROGRESS_LINES = 100


def emit(event: dict) -> None:
    print(PREFIX + json.dumps(event, separators=(",", ":")), file=sys.stderr, flush=True)


class Progress:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root
        self.runs = [] if root is None else history.read_runs(root)
        self.began = history.CLOCK()
        self.total = 0
        self.every = 1
        self.done = 0
        self.last = -1
        self.estimated: int | None = None
        self.said = False

    def elapsed_ms(self) -> float:
        return (history.CLOCK() - self.began) * 1000

    def start(self, total: int) -> None:
        self.total = total
        self.every = max(1, -(-total // MAX_PROGRESS_LINES))
        self.done = 0
        self.last = -1
        emit({"event": "start", "total": total, "unit": UNIT})
        self.estimate(force=True)

    def advance(self) -> None:
        self.done += 1

        if self.done % self.every == 0:
            self.report()

    def finish(self) -> None:
        if self.last != self.total:
            self.done = self.total
            self.report()

    def report(self) -> None:
        self.last = self.done
        emit({"event": "progress", "done": self.done, "total": self.total, "unit": UNIT})
        self.estimate()

    def estimate(self, force: bool = False) -> None:
        value = history.scaled_estimate(self.runs, self.total, self.elapsed_ms())

        if self.said and not force:
            if value == self.estimated:
                return

            moved = value is None or self.estimated is None
            moved = moved or abs(value - self.estimated) >= history.MOVE_MS

            if not moved:
                return

        self.estimated = value
        self.said = True
        emit({"event": "estimate", "remaining_ms": value})

    def complete(self) -> None:
        if self.root is None or self.total <= 0:
            return

        history.record_run(self.root, round(self.elapsed_ms()), self.total)
