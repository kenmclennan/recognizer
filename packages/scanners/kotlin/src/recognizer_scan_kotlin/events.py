import json
import sys

PREFIX = "recognizer-event "

UNIT = "files"

MAX_PROGRESS_LINES = 100


def emit(event: dict) -> None:
    print(PREFIX + json.dumps(event, separators=(",", ":")), file=sys.stderr, flush=True)


class Progress:
    def __init__(self) -> None:
        self.total = 0
        self.every = 1
        self.done = 0
        self.last = -1

    def start(self, total: int) -> None:
        self.total = total
        self.every = max(1, -(-total // MAX_PROGRESS_LINES))
        self.done = 0
        self.last = -1
        emit({"event": "start", "total": total, "unit": UNIT})

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
