import json
import sys
from pathlib import Path

from recognizer_sensors.outcome import Outcome
from recognizer_sensors.scans import Scan
from recognizer_sensors.settings import SettingsError, relative_path

DEFAULTS = {
    "overlay": ".recognizer/cache/overlays/mutate.json",
    "survivors": ".recognizer/cache/mutation/survivors.json",
}

PRINCIPLE = "Tests must catch changes"
FIX_PATTERN = "strengthen-tests"

METRIC_NAMES = ("killed", "survived", "uncovered", "score")
OVERLAY_KEYS = {"overlay_version", "commit", "modified", "producer", "metrics", "values"}


def parse_settings(raw: dict) -> dict:
    unknown = sorted(set(raw) - set(DEFAULTS))

    if unknown:
        raise SettingsError(f"unknown setting: {', '.join(unknown)}")

    settings = {**DEFAULTS, **raw}

    return {key: relative_path(key, settings[key]) for key in DEFAULTS}


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def valid_overlay(document: object) -> bool:
    if not isinstance(document, dict) or set(document) != OVERLAY_KEYS:
        return False

    values = document["values"]

    return (
        document["overlay_version"] == 1
        and isinstance(document["commit"], str)
        and isinstance(values, dict)
        and all(isinstance(values.get(name), dict) for name in METRIC_NAMES)
    )


def counts_agree(overlay: dict, survivors: dict) -> bool:
    functions = survivors.get("functions")

    if survivors.get("commit") != overlay["commit"] or not isinstance(functions, dict):
        return False

    survived = overlay["values"]["survived"]

    for identity in set(survived) | set(functions):
        entry = functions.get(identity)
        listed = entry.get("survivors") if isinstance(entry, dict) else []

        if not isinstance(listed, list) or survived.get(identity, 0) != len(listed):
            return False

    return True


def unknown(message: str) -> Outcome:
    print(f"recognizer-sensors: mutation: {message}; survivors are unknown", file=sys.stderr)

    return Outcome([])


def describe(survivor: dict) -> str:
    if survivor["replacement"] == "":
        return f"line {survivor['line']} {survivor['operator']} removed"

    return f"line {survivor['line']} {survivor['operator']} to {survivor['replacement']}"


def finding_for(identity: str, entry: dict, values: dict) -> dict:
    listed = entry["survivors"]
    noun = "mutation" if len(listed) == 1 else "mutations"
    measures = {name: values[name][identity] for name in ("killed", "survived", "uncovered")}

    if identity in values["score"]:
        measures["score"] = values["score"][identity]

    return {
        "id": f"mutation:{identity}",
        "kind": "mutation",
        "severity": "warning",
        "principle": PRINCIPLE,
        "fix_pattern": FIX_PATTERN,
        "summary": (
            f"{entry['name']} in {entry['module']} has {len(listed)} surviving {noun}: "
            + ", ".join(describe(s) for s in listed)
        ),
        "evidence": {
            "modules": [entry["module"]],
            "members": [
                {
                    "module": entry["module"],
                    "name": entry["name"],
                    "file": entry["file"],
                    "lines": entry["lines"],
                }
            ],
            "measures": measures,
        },
    }


def run(repository: Path, scans: list[Scan], settings: dict, commit: str) -> Outcome:
    overlay = read_json(repository / settings["overlay"])

    if not valid_overlay(overlay):
        return unknown(f"overlay {settings['overlay']} is missing or unreadable")

    if overlay["commit"] != commit:
        return unknown(f"overlay is from commit {overlay['commit']}, not {commit}")

    survivors = read_json(repository / settings["survivors"])

    if not isinstance(survivors, dict) or not counts_agree(overlay, survivors):
        return unknown(
            f"survivors file {settings['survivors']} is missing, unreadable, "
            "or does not match the overlay"
        )

    values = overlay["values"]
    findings = [
        finding_for(identity, entry, values)
        for identity, entry in survivors["functions"].items()
        if values["survived"].get(identity, 0) > 0
    ]

    return Outcome(findings)
