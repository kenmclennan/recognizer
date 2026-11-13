import json
import sys

PREFIX = "recognizer-event "


def emit(event: dict) -> None:
    print(PREFIX + json.dumps(event, separators=(",", ":")), file=sys.stderr, flush=True)


def start(total: int, unit: str) -> None:
    emit({"event": "start", "total": total, "unit": unit})


def progress(done: int, total: int, unit: str, step: str | None = None) -> None:
    event: dict = {"event": "progress", "done": done, "total": total, "unit": unit}

    if step is not None:
        event["step"] = step

    emit(event)


def note(text: str) -> None:
    emit({"event": "note", "text": text})


def diagnosis(value: dict) -> None:
    event: dict = {"event": "diagnosis", "code": value["code"], "text": value["line"]}

    if value.get("fix"):
        event["fix"] = value["fix"]

    emit(event)
