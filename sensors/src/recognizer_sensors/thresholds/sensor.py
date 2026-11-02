import json
import math
import re
import sys
from pathlib import Path

from recognizer_sensors.outcome import Outcome
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import SettingsError

DEFAULTS = {
    "complexity": {"above": 10, "severity": "warning"},
    "coverage": {"below": 0.6, "severity": "warning"},
}

PRINCIPLES = {"coverage": "tests-cover-the-code", "complexity": "functions-stay-small"}

NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")
ENTRY_KEYS = {"above", "below", "severity"}
SEVERITIES = ("warning", "violation")


def is_number(value: object) -> bool:
    return not isinstance(value, bool) and isinstance(value, int | float) and math.isfinite(value)


def parse_entry(name: str, entry: object) -> dict:
    if not isinstance(entry, dict):
        raise SettingsError(f"{name} must be off or an object with above or below")

    unknown = sorted(set(entry) - ENTRY_KEYS)

    if unknown:
        raise SettingsError(f"{name}: unknown key: {', '.join(unknown)}")

    lines = [key for key in ("above", "below") if key in entry]

    if len(lines) != 1:
        raise SettingsError(f"{name} must have exactly one of above or below")

    if not is_number(entry[lines[0]]):
        raise SettingsError(f"{name}.{lines[0]} must be a number")

    severity = entry.get("severity", "warning")

    if severity not in SEVERITIES:
        raise SettingsError(f"{name}.severity must be warning or violation")

    return {lines[0]: entry[lines[0]], "severity": severity}


def parse_settings(raw: dict) -> dict:
    effective = {name: dict(entry) for name, entry in DEFAULTS.items()}

    for name, entry in raw.items():
        if name == "command" or not NAME_PATTERN.match(name):
            raise SettingsError(f"invalid metric name: {name}")

        if entry == "off":
            effective.pop(name, None)

            continue

        effective[name] = parse_entry(name, entry)

    return {name: effective[name] for name in sorted(effective)}


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def valid_overlay(document: object) -> bool:
    if not isinstance(document, dict):
        return False

    producer = document.get("producer")

    return (
        document.get("overlay_version") == 1
        and isinstance(document.get("commit"), str)
        and isinstance(producer, dict)
        and isinstance(producer.get("name"), str)
        and isinstance(document.get("metrics"), list)
        and isinstance(document.get("values"), dict)
    )


def current_overlays(repository: Path, commit: str) -> list[dict]:
    folder = repository / ".recognizer" / "cache" / "overlays"
    overlays = []

    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        document = read_json(path)

        if not valid_overlay(document):
            print(
                f"recognizer-sensors: thresholds: overlay {path.name} is unreadable; skipped",
                file=sys.stderr,
            )

            continue

        if document["commit"] != commit:
            print(
                f"recognizer-sensors: thresholds: overlay {path.name} is from commit "
                f"{document['commit']}, not {commit}; skipped",
                file=sys.stderr,
            )

            continue

        overlays.append({"file": path.name, "document": document})

    return overlays


def declares(document: dict, metric: str) -> bool:
    return any(isinstance(m, dict) and m.get("name") == metric for m in document["metrics"])


def resolve(key: str, module_ids: list[str]) -> tuple[str, str | None] | None:
    if key in module_ids:
        return key, None

    matches = [m for m in module_ids if key.startswith(m + "::") and len(key) > len(m) + 2]

    if not matches:
        return None

    module = max(matches, key=len)

    return module, key[len(module) + 2 :]


def format_number(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))

    return repr(float(value))


def crosses(value: float, entry: dict) -> bool:
    if "above" in entry:
        return value >= entry["above"]

    return value < entry["below"]


def finding_for(metric, entry, key, module, member, value, producer) -> dict:
    if "above" in entry:
        line = entry["above"]
        phrase = "at or above"
    else:
        line = entry["below"]
        phrase = "below"

    evidence = {
        "modules": [module],
        "measures": {"value": value, "line": line},
        "producer": producer,
    }

    if member is not None:
        evidence["members"] = [{"module": module, "name": member}]

    return {
        "id": f"thresholds:{metric}:{key}",
        "kind": f"thresholds.{metric}",
        "severity": entry["severity"],
        "principle": PRINCIPLES.get(metric, metric),
        "metric": metric,
        "summary": f"{key}: {metric} {format_number(value)} is {phrase} {format_number(line)}",
        "evidence": evidence,
    }


def run(repository: Path, scans: list[Scan], settings: dict, commit: str) -> Outcome:
    module_ids = [module.id for scan in scans for module in scan.modules]
    overlays = current_overlays(repository, commit)
    findings = []

    for metric, entry in settings.items():
        source = next((o for o in overlays if declares(o["document"], metric)), None)

        if source is None:
            if metric not in DEFAULTS:
                print(
                    f"recognizer-sensors: thresholds: metric {metric} is in no current overlay",
                    file=sys.stderr,
                )

            continue

        values = source["document"]["values"].get(metric)
        producer = source["document"]["producer"]["name"]
        unresolved = 0

        for key, value in values.items() if isinstance(values, dict) else []:
            if not is_number(value):
                continue

            resolved = resolve(key, module_ids)

            if resolved is None:
                unresolved += 1

                continue

            if crosses(value, entry):
                module, member = resolved
                findings.append(finding_for(metric, entry, key, module, member, value, producer))

        if unresolved:
            print(
                f"recognizer-sensors: thresholds: {unresolved} ids of {metric} in "
                f"{source['file']} match no scanned module; skipped",
                file=sys.stderr,
            )

    return Outcome(findings)
