import json
from importlib.metadata import version

from recognizer_sensors.config_schema import CRAP_KEYS, MUTATION_KEYS, THRESHOLDS_KEYS

PROTOCOL = 1

INSTALL = "brew install --cask kenmclennan/tap/recognizer"

MEASURES = "evidence.measures"
MEMBER = "evidence.members.0"

LABELS = {"complexity": "cc", "coverage": "cov", "crap": "CRAP"}

METRIC_FIELDS = {
    "complexity": {
        "type": "count",
        "granularity": "member",
        "bad": "high",
        "help": (
            "How many independent paths run through the function; "
            "more paths are harder to test and to change."
        ),
        "published": {"value": 10, "source": "McCabe"},
    },
    "coverage": {
        "type": "ratio",
        "granularity": "member",
        "bad": "low",
        "help": "The share of the function's lines the tests run.",
        "published": {"value": 0.6, "source": "Google's guidelines"},
    },
    "crap": {
        "type": "number",
        "granularity": "member",
        "bad": "high",
        "help": (
            "Complexity weighed against coverage: the higher it "
            "is, the riskier the function is to change."
        ),
        "published": {"value": 30, "source": "Savoia and Evans"},
    },
    "killed": {
        "type": "count",
        "granularity": "member",
        "bad": "low",
        "help": "How many mutated copies of the function the tests caught.",
    },
    "survived": {
        "type": "count",
        "granularity": "member",
        "bad": "high",
        "help": "How many mutated copies of the function the tests let through.",
    },
    "uncovered": {
        "type": "count",
        "granularity": "member",
        "bad": "high",
        "help": "How many possible mutations fall on lines no test runs.",
    },
    "score": {
        "type": "ratio",
        "granularity": "member",
        "bad": "low",
        "help": "The share of mutated copies of the function the tests caught.",
    },
}

GROUPS = {
    "crap": {
        "name": "C.R.A.P.",
        "means": (
            "A function that is both complex and poorly covered by tests, so changing it is risky."
        ),
        "todo": "Add tests for it, or simplify it; either lowers the score.",
    },
    "mutation": {
        "name": "Mutations",
        "means": (
            "Recognizer changed this function's code and no test "
            "failed, so the tests do not pin its behaviour."
        ),
        "todo": "Add a test that fails when this function's behaviour changes.",
    },
    "thresholds": {
        "name": "Over a limit",
        "means": "A measure passed a limit set in your config, such as module size.",
        "todo": "Bring it back under the limit, or raise the limit if it is wrong.",
    },
}


def metric(name: str) -> dict:
    fields = dict(METRIC_FIELDS[name])
    published = fields.pop("published", None)
    entry = {
        "name": name,
        "label": LABELS.get(name, name),
        "help": fields.pop("help"),
        **fields,
    }

    if published is not None:
        entry["published"] = published

    return entry


def variant(text: str, *when: dict) -> dict:
    return {"when": list(when), "text": text} if when else {"text": text}


def has(path: str) -> dict:
    return {"has": path}


def crap_sentence() -> dict:
    complexity = f"{MEASURES}.complexity"
    coverage = f"{MEASURES}.coverage"
    score = f"{MEASURES}.crap"
    published = f"{MEASURES}.published"

    return {
        "requires": [f"{MEMBER}.name", f"{MEMBER}.module", complexity],
        "parts": [
            [
                variant(
                    f"{{{MEMBER}.name}} in {{{MEMBER}.module|short}} has complexity "
                    f"{{{complexity}|num}}"
                )
            ],
            [
                variant(
                    f" and {{{coverage}|percent}}% coverage, C.R.A.P. {{{score}|whole}}",
                    has(coverage),
                    has(score),
                ),
                variant(" and unknown coverage"),
            ],
            [
                variant(
                    f" (Savoia and Evans say {{{published}|num}})",
                    has(coverage),
                    has(score),
                    has(published),
                )
            ],
            [variant(".")],
        ],
    }


def mutation_sentence() -> dict:
    survived = f"{MEASURES}.survived"

    return {
        "requires": [f"{MEMBER}.name", f"{MEMBER}.module", survived],
        "parts": [
            [
                variant(
                    f"{{{MEMBER}.name}} in {{{MEMBER}.module|short}} has {{{survived}|num}} "
                    f"surviving {{{survived}|plural:mutation:mutations}}"
                )
            ],
            [variant(".")],
        ],
    }


def thresholds_sentence() -> dict:
    value = f"{MEASURES}.value"
    line = f"{MEASURES}.line"
    published = f"{MEASURES}.published"

    return {
        "requires": [value, line, "evidence.modules.0"],
        "parts": [
            [
                variant(f"{{{MEMBER}.name}} in {{{MEMBER}.module|short}}", has(f"{MEMBER}.name")),
                variant("{evidence.modules.0|short}"),
            ],
            [variant(f" has {{metric}} {{{value}|num}}, ")],
            [
                variant(
                    f"over the limit of {{{line}|num}}",
                    {"left": value, "op": "gt", "right": line},
                ),
                variant(
                    f"under the limit of {{{line}|num}}",
                    {"left": value, "op": "lt", "right": line},
                ),
                variant(f"at the limit of {{{line}|num}}"),
            ],
            [
                variant(
                    f" (Google's guidelines say {{{published}|percent}}%)",
                    {"path": "kind", "is": "thresholds.coverage"},
                    has(published),
                ),
                variant(f" (McCabe says {{{published}|num}})", has(published)),
            ],
            [variant(".")],
        ],
    }


def finding(kind: str, group: str, help_text: str, sentence: dict) -> dict:
    return {"kind": kind, "group": GROUPS[group], "help": help_text, "sentence": sentence}


def strip(prefix: str, keys) -> list[dict]:
    return [{**entry, "key": entry["key"].removeprefix(prefix)} for entry in keys]


def common(name: str, display: str, check: bool, units: str, settings: list[dict]) -> dict:
    return {
        "kind": "sensor",
        "name": name,
        "display": display,
        "version": version("recognizer-sensors"),
        "protocol": PROTOCOL,
        "install": INSTALL,
        "check": check,
        "long_running": name != "thresholds",
        **({"time_limit_seconds": 60} if name == "thresholds" else {}),
        "units": [units],
        "settings": settings,
    }


def build(name: str) -> dict:
    if name == "crap":
        return {
            **common("crap", "C.R.A.P.", True, "functions", strip("sensors.crap.", CRAP_KEYS)),
            "metrics": [metric("complexity"), metric("coverage"), metric("crap")],
            "findings": [
                finding(
                    "crap",
                    "crap",
                    "One finding per function whose C.R.A.P. score is over the threshold.",
                    crap_sentence(),
                )
            ],
            "runs_tests": True,
            "scoped": False,
        }

    if name == "mutation":
        return {
            **common(
                "mutation",
                "Mutation",
                True,
                "functions",
                strip("sensors.mutation.", MUTATION_KEYS),
            ),
            "metrics": [metric(n) for n in ("killed", "survived", "uncovered", "score")],
            "findings": [
                finding(
                    "mutation",
                    "mutation",
                    "One finding per function with at least one surviving mutation.",
                    mutation_sentence(),
                )
            ],
            "runs_tests": True,
            "scoped": True,
        }

    return {
        **common(
            "thresholds",
            "Thresholds",
            False,
            "modules",
            strip("sensors.thresholds.", THRESHOLDS_KEYS),
        ),
        "metrics": [],
        "findings": [
            finding(
                "thresholds.<metric>",
                "thresholds",
                "One finding per module or function whose metric passed a configured limit.",
                thresholds_sentence(),
            )
        ],
        "runs_tests": False,
        "scoped": False,
    }


def manifest_text(name: str) -> str:
    return json.dumps(build(name), indent=2) + "\n"
