import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from recognizer_scan_kotlin import scan

REPOSITORY = Path(__file__).parents[3]
SCHEMA_PATH = REPOSITORY / "schema" / "scan.schema.json"
EXAMPLES = REPOSITORY / "schema" / "examples"
FIXTURE_ROOT = REPOSITORY / "fixtures" / "kotlin" / "sample"
EXPECTED_SCAN = REPOSITORY / "fixtures" / "kotlin" / "expected-scan.json"


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def validate(document: dict) -> None:
    Draft202012Validator(load_schema()).validate(document)

    ids = [m["id"] for m in document["modules"]]
    foreign_ids = [f["id"] for f in document["foreign"]]

    assert len(ids) == len(set(ids))
    assert len(foreign_ids) == len(set(foreign_ids))
    assert all(f["id"] == f"foreign:{f['name']}" for f in document["foreign"])

    for edge in document["edges"]:
        assert edge["from"] in ids
        assert edge["to"] in ids or edge["to"] in foreign_ids

    for item in document.get("unresolved_imports", []):
        assert item["from"] in ids

    endpoints = {}

    for item in document["modules"]:
        for member in item["members"]:
            endpoints[f"{item['id']}::{member['name']}"] = member

            for method in member.get("methods", []):
                endpoints[f"{item['id']}::{member['name']}.{method['name']}"] = method

    for call in document.get("calls", []):
        assert call["from"] in endpoints
        assert call["to"] in endpoints
        assert call["from"] != call["to"]


def build_tree(base: Path, files: dict[str, str]) -> Path:
    for relative, content in files.items():
        path = base / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    return base


@pytest.fixture
def run(tmp_path):
    def _run(files: dict[str, str], commit=None) -> dict:
        build_tree(tmp_path, files)
        document = scan(tmp_path, commit)
        validate(document)

        return document

    return _run


def edges_of(document: dict, source: str | None = None, kind: str | None = None) -> list[dict]:
    return [
        e
        for e in document["edges"]
        if (source is None or e["from"] == source) and (kind is None or e["kind"] == kind)
    ]


def targets(document: dict, source: str, kind: str = "depends") -> dict[str, list[str]]:
    return {e["to"]: e.get("names", []) for e in edges_of(document, source, kind)}


def module(document: dict, module_id: str) -> dict:
    return next(m for m in document["modules"] if m["id"] == module_id)


def member(document: dict, module_id: str, name: str) -> dict:
    return next(m for m in module(document, module_id)["members"] if m["name"] == name)


def call_tuples(document: dict) -> list[tuple]:
    return [(c["from"], c["to"], c["how"]) for c in document["calls"]]
