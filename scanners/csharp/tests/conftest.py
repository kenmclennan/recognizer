import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from recognizer_scan_csharp import scan

REPOSITORY = Path(__file__).parents[3]
SCHEMA_PATH = REPOSITORY / "schema" / "scan.schema.json"
EXAMPLES = REPOSITORY / "schema" / "examples"
FIXTURE_ROOT = REPOSITORY / "fixtures" / "csharp" / "sample"
EXPECTED_SCAN = REPOSITORY / "fixtures" / "csharp" / "expected-scan.json"


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

    members = set()

    for item in document["modules"]:
        for entry in item["members"]:
            members.add(f"{item['id']}::{entry['name']}")
            members.update(f"{item['id']}::{entry['name']}.{m['name']}" for m in entry["methods"])

    for call in document["calls"]:
        assert call["from"] in members
        assert call["to"] in members
        assert call["from"] != call["to"]

    for item in document.get("unresolved_imports", []):
        assert item["from"] in ids


def build_tree(base: Path, files: dict[str, str]) -> Path:
    for relative, content in files.items():
        path = base / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    return base


def csproj(
    sdk: str = "Microsoft.NET.Sdk",
    properties: dict[str, str] | None = None,
    packages: tuple[str, ...] = (),
    references: tuple[str, ...] = (),
    usings: tuple[str, ...] = (),
    compiles: tuple[tuple[str, str], ...] = (),
) -> str:
    lines = [f'<Project Sdk="{sdk}">', "  <PropertyGroup>"]

    for name, value in (properties or {}).items():
        lines.append(f"    <{name}>{value}</{name}>")

    lines += ["  </PropertyGroup>", "  <ItemGroup>"]
    lines += [f'    <PackageReference Include="{p}" Version="1.0.0" />' for p in packages]
    lines += [f'    <ProjectReference Include="{r}" />' for r in references]
    lines += [f'    <Using Include="{u}" />' for u in usings]
    lines += [f'    <Compile Include="{c}" Link="{link}" />' for c, link in compiles]
    lines += ["  </ItemGroup>", "</Project>", ""]

    return "\n".join(lines)


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


def local_targets(document: dict, source: str) -> dict[str, list[str]]:
    return {t: n for t, n in targets(document, source).items() if not t.startswith("foreign:")}


def calls_of(document: dict, source: str | None = None, how: str | None = None) -> list[tuple]:
    return [
        (c["from"], c["to"], c["line"], c["how"])
        for c in document["calls"]
        if (source is None or c["from"] == source) and (how is None or c["how"] == how)
    ]


def module(document: dict, module_id: str) -> dict:
    return next(m for m in document["modules"] if m["id"] == module_id)


def member(document: dict, module_id: str, name: str) -> dict:
    return next(m for m in module(document, module_id)["members"] if m["name"] == name)


def module_ids(document: dict) -> list[str]:
    return [m["id"] for m in document["modules"]]
