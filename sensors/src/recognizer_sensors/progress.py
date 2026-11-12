import json
import os
import sys

PREFIX = "recognizer-progress "

SWITCH = "RECOGNIZER_PROGRESS"


def enabled() -> bool:
    return os.environ.get(SWITCH) == "1"


def render(
    step: str, done: int | None = None, total: int | None = None, suite: str | None = None
) -> str:
    message: dict = {"step": step}

    if suite is not None:
        message["suite"] = suite

    if done is not None and total is not None:
        message.update(done=done, total=total)

    return PREFIX + json.dumps(message, separators=(",", ":"))


def report(
    step: str, done: int | None = None, total: int | None = None, suite: str | None = None
) -> None:
    if enabled():
        print(render(step, done, total, suite), file=sys.stderr, flush=True)
