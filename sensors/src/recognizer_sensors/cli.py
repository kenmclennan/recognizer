import argparse
import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from recognizer_sensors.duplication.sensor import SettingsError
from recognizer_sensors.findings import build_document, render, write_atomically
from recognizer_sensors.registry import SHIPPED
from recognizer_sensors.scans import read_scans

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


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
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
    findings = sensor.run(args.repository, scans, settings)
    document = build_document(
        args.name,
        version("recognizer-sensors"),
        commit,
        any(scan.modified for scan in scans),
        settings,
        findings,
    )
    text = render(document)

    if args.output:
        write_atomically(text, args.output)
    else:
        sys.stdout.write(text)

    return 0
