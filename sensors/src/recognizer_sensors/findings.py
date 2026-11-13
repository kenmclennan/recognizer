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
    partial: dict | None = None,
    inputs: dict[str, str] | None = None,
    tests: str | None = None,
    diagnosis: dict | None = None,
    counts: dict | None = None,
    excluded: dict | None = None,
    unowned: dict | None = None,
    suites: list[dict] | None = None,
    work: dict | None = None,
) -> dict:
    document = {
        "findings_version": 2,
        "sensor": {"name": name, "version": version},
        "commit": commit,
        "modified": modified,
        "settings": settings,
        "findings": sorted(findings, key=lambda finding: finding["id"]),
        "inputs": inputs or {},
    }

    if tests is not None:
        document["tests"] = tests

    if diagnosis is not None:
        document["diagnosis"] = diagnosis

    if stopped is not None:
        document["stopped"] = stopped

    if partial is not None:
        document["partial"] = partial

    if counts is not None:
        document["counts"] = counts

    if excluded is not None:
        document["excluded"] = excluded

    if unowned is not None:
        document["unowned"] = unowned

    if suites is not None:
        document["suites"] = suites

    if work is not None:
        document["work"] = work

    return document


def build_overlay(
    name: str,
    version: str,
    commit: str,
    modified: bool,
    overlay: Overlay,
    inputs: dict[str, str] | None = None,
    tests: str | None = None,
) -> dict:
    document = {
        "overlay_version": 2,
        "commit": commit,
        "modified": modified,
        "producer": {"name": name, "version": version},
        "metrics": overlay.metrics,
        "values": {
            metric: dict(sorted(entries.items())) for metric, entries in overlay.values.items()
        },
        "inputs": inputs or {},
    }

    if tests is not None:
        document["tests"] = tests

    return document


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
