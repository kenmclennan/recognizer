import argparse
import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from recognizer_sensors.config_schema import schema_text
from recognizer_sensors.findings import (
    build_document,
    build_overlay,
    render,
    write_atomically,
)
from recognizer_sensors.hashes import inputs_map, scan_hashes
from recognizer_sensors.mutation.runner import STOPPED_STATUS
from recognizer_sensors.outcome import Outcome
from recognizer_sensors.registry import SHIPPED
from recognizer_sensors.scans import read_scans
from recognizer_sensors.settings import MeasurementError, Refusal, SettingsError
from recognizer_sensors.testrun.suites import Suite, selected

RECURSION_LIMIT = 20000

REASON_PREFIX = "recognizer-reason "


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
    parser.add_argument("name", nargs="?")
    parser.add_argument("--repository", type=Path, default=Path("."))
    parser.add_argument("--commit")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--settings")
    parser.add_argument("--modules", type=Path)
    parser.add_argument("--suites")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--guide", action="store_true")
    parser.add_argument("--schema", action="store_true")
    parser.add_argument("--version", action="version", version=package_version)

    return parser


def fail(message: str) -> int:
    print(f"recognizer-sensors: {message}", file=sys.stderr)

    return 2


def print_schema(args) -> int:
    other = (
        args.check
        or args.run
        or args.guide
        or args.settings is not None
        or args.output is not None
        or args.modules is not None
        or args.suites is not None
    )

    if args.name is not None or other:
        return fail("--schema takes no sensor name and no other option than --repository")

    sys.stdout.write(schema_text())

    return 0


def parse_raw_settings(text: str) -> dict | None:
    try:
        value = json.loads(text)
    except ValueError:
        return None

    return value if isinstance(value, dict) else None


def read_scope(path: Path) -> set[str] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        return None

    return set(value)


def read_suite_names(text: str) -> list[str] | None:
    try:
        value = json.loads(text)
    except ValueError:
        return None

    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        return None

    return value


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


def check(
    sensor, repository: Path, settings: dict, run: bool, names: list[str] | None = None
) -> int:
    gaps, notes = sensor.check(repository, settings, run, names)
    sys.stdout.write(json.dumps({"gaps": gaps, "notes": notes}) + "\n")

    return 0


def config_gap(error: SettingsError) -> int:
    gap = {"code": "config", "suite": None, "line": str(error)}
    sys.stdout.write(json.dumps({"gaps": [gap], "notes": []}) + "\n")

    return 0


def main(argv: list[str] | None = None) -> int:
    package_version = version("recognizer-sensors")
    args = build_parser(package_version).parse_args(argv)

    if args.schema:
        return print_schema(args)

    if args.name is None:
        return fail("a sensor name is required")

    sensor = SHIPPED.get(args.name)

    if sensor is None:
        return fail(f"unknown sensor: {args.name}")

    if args.run and not args.check:
        return fail("--run is valid only with --check")

    if args.guide:
        if sensor.guide is not None:
            sys.stdout.write(sensor.guide())

        return 0

    if args.modules is not None and not sensor.scoped:
        return fail(f"{args.name} takes no module scope")

    if args.suites is not None and not sensor.runs_tests:
        return fail(f"{args.name} takes no test suites")

    names = None

    if args.suites is not None:
        names = read_suite_names(args.suites)

        if names is None:
            return fail("--suites must be a JSON array of suite names")

    scope = None

    if args.modules is not None:
        scope = read_scope(args.modules)

        if scope is None:
            return fail("--modules must name a JSON file holding an array of module ids")

    raw = parse_raw_settings("{}" if args.settings is None else args.settings)

    if raw is None:
        return fail("--settings must be a JSON object")

    try:
        settings = sensor.parse_settings(raw)
    except SettingsError as error:
        if args.check and args.repository.is_dir():
            return config_gap(error)

        return fail(str(error))

    if names is not None:
        try:
            selected([Suite(**item) for item in settings.get("suites") or []], names)
        except SettingsError as error:
            return fail(str(error))

    if not args.repository.is_dir():
        return fail(f"--repository is not a directory: {args.repository}")

    if args.check:
        return check(sensor, args.repository, settings, args.run, names)

    commit = args.commit if args.commit else resolve_commit(args.repository)

    if not commit:
        return fail("not a git repository, or no commit")

    sys.setrecursionlimit(RECURSION_LIMIT)

    scans = read_scans(args.repository)

    modified = (
        is_dirty(args.repository) if sensor.runs_tests else any(scan.modified for scan in scans)
    )

    def emit(outcome: Outcome, final: bool) -> None:
        for path, document in outcome.documents:
            path.parent.mkdir(parents=True, exist_ok=True)
            write_atomically(render(document), path)

        inputs = inputs_map(outcome.inputs, scan_hashes(scans))
        inputs.update({m: h for m, h in outcome.recorded_inputs.items() if m in inputs})
        progress = {"measured": outcome.measured, "total": outcome.total}
        document = build_document(
            args.name,
            package_version,
            commit,
            modified,
            settings,
            outcome.findings,
            progress if outcome.stopped else None,
            progress if outcome.total > outcome.measured else None,
            inputs,
            outcome.tests,
            outcome.diagnosis,
            progress if outcome.total > 0 else None,
            outcome.excluded,
            outcome.unowned,
            outcome.suites,
        )

        if outcome.overlay is not None:
            overlay = build_overlay(
                args.name, package_version, commit, modified, outcome.overlay, inputs, outcome.tests
            )
            outcome.overlay.path.parent.mkdir(parents=True, exist_ok=True)
            write_atomically(render(overlay), outcome.overlay.path)

        if args.output:
            write_atomically(render(document), args.output)
        elif final:
            sys.stdout.write(render(document))

    try:
        extra = {"modules": scope} if sensor.scoped else {}

        if sensor.runs_tests and names is not None:
            extra["names"] = names

        if sensor.checkpoints:
            extra["checkpoint"] = lambda partial: emit(partial, False)

        outcome = (
            sensor.run(args.repository, scans, settings, commit, **extra)
            if sensor.needs_commit
            else sensor.run(args.repository, scans, settings, **extra)
        )
    except Refusal as refusal:
        print(f"{REASON_PREFIX}{json.dumps(refusal.diagnosis)}", file=sys.stderr)
        print(str(refusal), file=sys.stderr)

        return 2
    except MeasurementError as error:
        print(str(error), file=sys.stderr)

        return 2

    emit(outcome, True)

    if outcome.refused:
        print(f"{REASON_PREFIX}{json.dumps(outcome.diagnosis)}", file=sys.stderr)
        print(outcome.diagnosis["line"], file=sys.stderr)

        return 2

    return STOPPED_STATUS if outcome.stopped else 0
