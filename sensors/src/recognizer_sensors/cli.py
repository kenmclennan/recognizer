import argparse
import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from recognizer_sensors.findings import (
    build_document,
    build_overlay,
    render,
    write_atomically,
)
from recognizer_sensors.mutation.runner import STOPPED_STATUS
from recognizer_sensors.registry import SHIPPED
from recognizer_sensors.scans import read_scans
from recognizer_sensors.settings import MeasurementError, SettingsError

RECURSION_LIMIT = 20000


def resolve_commit(root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None

    sha = result.stdout.strip()

    return sha if result.returncode == 0 and sha else None


def build_parser(package_version: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="recognizer-sensors")
    parser.add_argument("name")
    parser.add_argument("--repository", type=Path, default=Path("."))
    parser.add_argument("--commit")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--settings", default="{}")
    parser.add_argument("--version", action="version", version=package_version)

    return parser


def fail(message: str) -> int:
    print(f"recognizer-sensors: {message}", file=sys.stderr)

    return 2


def parse_raw_settings(text: str) -> dict | None:
    try:
        value = json.loads(text)
    except ValueError:
        return None

    return value if isinstance(value, dict) else None


def is_dirty(root: Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain", "--", ".", ":!.recognizer"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return True

    return result.returncode != 0 or bool(result.stdout.strip())


def main(argv: list[str] | None = None) -> int:
    package_version = version("recognizer-sensors")
    args = build_parser(package_version).parse_args(argv)
    sensor = SHIPPED.get(args.name)

    if sensor is None:
        return fail(f"unknown sensor: {args.name}")

    raw = parse_raw_settings(args.settings)

    if raw is None:
        return fail("--settings must be a JSON object")

    try:
        settings = sensor.parse_settings(raw)
    except SettingsError as error:
        return fail(str(error))

    if not args.repository.is_dir():
        return fail(f"--repository is not a directory: {args.repository}")

    commit = args.commit if args.commit else resolve_commit(args.repository)

    if not commit:
        return fail("not a git repository, or no commit")

    sys.setrecursionlimit(RECURSION_LIMIT)

    scans = read_scans(args.repository)

    modified = (
        is_dirty(args.repository) if sensor.runs_tests else any(scan.modified for scan in scans)
    )

    try:
        outcome = (
            sensor.run(args.repository, scans, settings, commit)
            if sensor.needs_commit
            else sensor.run(args.repository, scans, settings)
        )
    except MeasurementError as error:
        print(str(error), file=sys.stderr)

        return 2

    for path, document in outcome.documents:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(render(document), path)

    document = build_document(
        args.name,
        package_version,
        commit,
        modified,
        settings,
        outcome.findings,
        {"measured": outcome.measured, "total": outcome.total} if outcome.stopped else None,
    )
    text = render(document)

    if outcome.overlay is not None:
        overlay = build_overlay(args.name, package_version, commit, modified, outcome.overlay)
        outcome.overlay.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(render(overlay), outcome.overlay.path)

    if args.output:
        write_atomically(text, args.output)
    else:
        sys.stdout.write(text)

    return STOPPED_STATUS if outcome.stopped else 0
