import json
import os
import tempfile
from pathlib import Path


def build_document(
    name: str,
    version: str,
    commit: str,
    modified: bool,
    settings: dict,
    findings: list[dict],
) -> dict:
    return {
        "findings_version": 1,
        "sensor": {"name": name, "version": version},
        "commit": commit,
        "modified": modified,
        "settings": settings,
        "findings": sorted(findings, key=lambda finding: finding["id"]),
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
