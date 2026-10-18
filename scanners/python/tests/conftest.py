import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from recognizer_scan_python import scan

REPOSITORY = Path(__file__).parents[3]
SCHEMA_PATH = REPOSITORY / "schema" / "scan.schema.json"
EXAMPLES = REPOSITORY / "schema" / "examples"
FIXTURE_ROOT = REPOSITORY / "fixtures" / "python" / "sample"
EXPECTED_SCAN = REPOSITORY / "fixtures" / "python" / "expected-scan.json"


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def validate(document: dict) -> None:
    Draft202012Validator(load_schema()).validate(document)

    ids = [m["id"] for m in document["modules"]]
    foreign_ids = [f["id"] for f in document["foreign"]]

    assert len(ids) == len(set(ids))
    assert len(foreign_ids) == len(set(foreign_ids))
    assert all(f["id"] == f"foreign:{f['name']}" for f in document["foreign"])
    assert not any(i.startswith(("./", "/")) for i in ids)

    for edge in document["edges"]:
        assert edge["from"] in ids
        assert edge["to"] in ids or edge["to"] in foreign_ids


def build_tree(base: Path, files: dict[str, str]) -> Path:
    for relative, content in files.items():
        path = base / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    return base


@pytest.fixture
def run(tmp_path):
    def _run(files: dict[str, str], source_roots=None, commit=None) -> dict:
        build_tree(tmp_path, files)
        document = scan(tmp_path, source_roots or ["."], commit)
        validate(document)

        return document

    return _run


def edge_tuples(document: dict, source: str | None = None) -> list[tuple]:
    return [
        (e["from"], e["to"], e["kind"], e["line"], e.get("member"), e.get("to_member"))
        for e in document["edges"]
        if source is None or e["from"] == source
    ]


def module(document: dict, module_id: str) -> dict:
    return next(m for m in document["modules"] if m["id"] == module_id)
