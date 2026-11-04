import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from recognizer_sensors.cli import main

REPOSITORY = Path(__file__).parents[2]
FIXTURE = REPOSITORY / "fixtures" / "duplication" / "sample"
FINDINGS_SCHEMA = REPOSITORY / "schema" / "findings.schema.json"
SHIPPED = REPOSITORY / "fixtures" / "sensors" / "shipped.json"
SENSOR_LIST = REPOSITORY / "fixtures" / "sensors" / "list.json"

LANGUAGE_BY_SUFFIX = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".kt": "kotlin",
    ".rs": "rust",
}


def write_scans(root: Path, modified: bool | None = False) -> None:
    by_language: dict[str, list[str]] = {}

    for path in sorted(p for p in root.rglob("*") if p.is_file() and ".recognizer" not in p.parts):
        language = LANGUAGE_BY_SUFFIX.get(path.suffix)

        if language:
            by_language.setdefault(language, []).append(path.relative_to(root).as_posix())

    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True, exist_ok=True)

    for language, files in by_language.items():
        document = {
            "files": [{"path": f, "hash": "0" * 64} for f in files],
            "modules": [{"id": f} for f in files],
            "modified": modified,
        }

        (cache / f"scan.{language}.json").write_text(json.dumps(document))


def make_repository(root: Path, files: dict[str, str], modified: bool | None = False) -> Path:
    for name, text in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    write_scans(root, modified)

    return root


def git_commit(root: Path) -> str:
    env = {
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
        "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
    }

    for args in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "x"]):
        subprocess.run(["git", "-C", str(root), *args], check=True, env=env, capture_output=True)

    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()


@pytest.fixture
def sample(tmp_path) -> Path:
    root = tmp_path / "sample"
    shutil.copytree(FIXTURE, root)
    write_scans(root)

    return root


def run_cli(root: Path, output: Path, *extra: str) -> int:
    return main(
        [
            "duplication",
            "--repository",
            str(root),
            "--commit",
            "c1",
            "--output",
            str(output),
            *extra,
        ]
    )


MUTATE_FIXTURE = REPOSITORY / "fixtures" / "mutation" / "sample"
STOP_FIXTURE = REPOSITORY / "fixtures" / "mutation" / "stop"
OVERLAY_SCHEMA = REPOSITORY / "schema" / "overlay.schema.json"


def mutate_repository(tmp_path: Path, fixture: Path = MUTATE_FIXTURE) -> tuple[Path, str]:
    root = tmp_path / "sample"
    shutil.copytree(
        fixture,
        root,
        ignore=shutil.ignore_patterns("scan.python.json"),
    )
    commit = git_commit(root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    shutil.copy(fixture / "scan.python.json", cache / "scan.python.json")

    return root, commit


def mutate_settings(script: str, **extra) -> str:
    return json.dumps(
        {"test_command": [sys.executable, script], "coverage": "coverage/lcov.info", **extra}
    )


def write_scan_document(
    root: Path, language: str, modules: list[dict], edges: list[dict], files: list[str]
) -> None:
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    document = {
        "files": [{"path": f, "hash": "0" * 64} for f in files],
        "modules": modules,
        "edges": edges,
        "modified": False,
    }
    (cache / f"scan.{language}.json").write_text(json.dumps(document))


def exports_module(module_id: str, *names: str, hidden: tuple[str, ...] = ()) -> dict:
    members = [
        {"name": n, "kind": "function", "line": 10 + i, "exported": True}
        for i, n in enumerate(names)
    ] + [
        {"name": n, "kind": "function", "line": 50 + i, "exported": False}
        for i, n in enumerate(hidden)
    ]

    return {"id": module_id, "members": members}
