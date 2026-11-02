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
from recognizer_sensors.registry import MEASURERS, SHIPPED
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="recognizer-sensors")
    parser.add_argument("name")
    parser.add_argument("--repository", type=Path, default=Path("."))
    parser.add_argument("--commit")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--settings", default="{}")
    parser.add_argument("--version", action="version", version=version("recognizer-sensors"))

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


def measure(args, measurer, scans, settings: dict, commit: str) -> int:
    modified = is_dirty(args.repository)

    try:
        measurement = measurer.run(args.repository, scans, settings, commit, modified)
    except MeasurementError as error:
        return fail(str(error))

    package_version = version("recognizer-sensors")
    overlay = build_overlay(args.name, package_version, commit, modified, measurement.overlay)
    survivors_path = args.repository / settings["survivors"]
    survivors_path.parent.mkdir(parents=True, exist_ok=True)
    write_atomically(render(measurement.survivors), survivors_path)
    text = render(overlay)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(text, args.output)
    else:
        sys.stdout.write(text)

    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    sensor = SHIPPED.get(args.name) or MEASURERS.get(args.name)

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

    if args.name in MEASURERS:
        return measure(args, sensor, scans, settings, commit)

    outcome = (
        sensor.run(args.repository, scans, settings, commit)
        if sensor.needs_commit
        else sensor.run(args.repository, scans, settings)
    )
    modified = any(scan.modified for scan in scans)
    document = build_document(
        args.name,
        version("recognizer-sensors"),
        commit,
        modified,
        settings,
        outcome.findings,
    )
    text = render(document)

    if outcome.overlay is not None:
        overlay = build_overlay(
            args.name, version("recognizer-sensors"), commit, modified, outcome.overlay
        )
        outcome.overlay.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(render(overlay), outcome.overlay.path)

    if args.output:
        write_atomically(text, args.output)
    else:
        sys.stdout.write(text)

    return 0
