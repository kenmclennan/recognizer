import json
import os
import tempfile
from pathlib import Path

from recognizer_sensors.outcome import Overlay


def build_document(
    name: str,
    version: str,
    commit: str,
    modified: bool,
    settings: dict,
    findings: list[dict],
    stopped: dict | None = None,
) -> dict:
    document = {
        "findings_version": 1,
        "sensor": {"name": name, "version": version},
        "commit": commit,
        "modified": modified,
        "settings": settings,
        "findings": sorted(findings, key=lambda finding: finding["id"]),
    }

    if stopped is not None:
        document["stopped"] = stopped

    return document


def build_overlay(name: str, version: str, commit: str, modified: bool, overlay: Overlay) -> dict:
    return {
        "overlay_version": 1,
        "commit": commit,
        "modified": modified,
        "producer": {"name": name, "version": version},
        "metrics": overlay.metrics,
        "values": {
            metric: dict(sorted(entries.items())) for metric, entries in overlay.values.items()
        },
    }


def render(document: dict) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def write_atomically(text: str, output: Path) -> None:
    handle, temporary = tempfile.mkstemp(dir=output.parent, prefix=f".{output.name}.")

    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(text)

        os.replace(temporary, output)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)

        raise
