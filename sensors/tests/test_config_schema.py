import json
import re
from pathlib import Path

import jsonschema
import pytest
from conftest import REPOSITORY

from recognizer_sensors.cli import main
from recognizer_sensors.config_schema import key_schema
from recognizer_sensors.registry import SHIPPED
from recognizer_sensors.testrun.suites import parse_suite

KEYS_SCHEMA = REPOSITORY / "schema" / "config-keys.schema.json"
CONFIG_SCHEMA = REPOSITORY / "schema" / "config.schema.json"
EXAMPLES = REPOSITORY / "schema" / "config-keys-examples"

BOUNDS = ("minimum", "exclusiveMinimum", "maximum", "exclusiveMaximum")


def run_cli(argv, capsys):
    status = main(argv)

    return status, capsys.readouterr().out


def published():
    return {entry["key"]: entry for entry in key_schema()["keys"]}


def test_schema_prints_a_document_that_validates_against_the_key_schema(capsys):
    status, out = run_cli(["--schema"], capsys)

    assert status == 0
    assert json.loads(out) == key_schema()

    jsonschema.validate(json.loads(out), json.loads(KEYS_SCHEMA.read_text()))


@pytest.mark.parametrize(
    "argv",
    [
        ["--schema", "crap"],
        ["--schema", "check"],
        ["--schema", "--run"],
        ["--schema", "guide"],
        ["--schema", "--settings", "{}"],
        ["--schema", "--output", "x"],
        ["--schema", "--modules", "x"],
        [],
    ],
)
def test_schema_with_a_name_or_another_mode_and_a_missing_name_are_exit_two(argv, capsys):
    status, out = run_cli(argv, capsys)

    assert status == 2
    assert out == ""


def test_the_valid_and_invalid_examples_are_told_apart_by_the_key_schema():
    schema = json.loads(KEYS_SCHEMA.read_text())
    valid = sorted((EXAMPLES / "valid").glob("*.json"))
    invalid = sorted((EXAMPLES / "invalid").glob("*.json"))

    assert valid
    assert invalid

    for path in valid:
        jsonschema.validate(json.loads(path.read_text()), schema)

    for path in invalid:
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(json.loads(path.read_text()), schema)


def test_every_published_example_names_a_published_key_or_section():
    document = key_schema()
    patterns = []

    for entry in [*document["keys"], *document["sections"]]:
        parts = [
            "[^.]+" if part.startswith("<") else re.escape(part) for part in entry["key"].split(".")
        ]
        patterns.append(re.compile("^" + r"\.".join(parts) + "$"))

    assert patterns

    for entry in [*document["keys"], *document["sections"]]:
        example = entry["example"].split()
        target = next(word for word in example if not word.startswith("--"))

        assert any(pattern.match(target) for pattern in patterns), entry["key"]


def segments_match(key, typed):
    parts = key.split(".")

    return len(parts) == len(typed) and all(
        part.startswith("<") or part == word for part, word in zip(parts, typed, strict=True)
    )


def example_value(entry):
    words = entry["example"].split(None, 2 if entry["example"].startswith("--") else 1)

    return words[-1].strip("\"'")


def coerce(entry, text):
    kind = entry["type"]

    if kind == "integer":
        return int(text)

    if kind == "number":
        return float(text) if "." in text else int(text)

    if kind == "boolean":
        return text == "true"

    return text


def settings_path(typed):
    return typed[2:]


def nest(path, value):
    for part in reversed(path):
        value = {part: value}

    return value


def test_the_example_of_every_sensor_key_is_accepted_by_that_sensor_parser():
    checked = []

    for entry in key_schema()["keys"]:
        parts = entry["key"].split(".")

        if parts[0] != "sensors":
            continue

        sensor = SHIPPED[parts[1]]
        typed = entry["example"].split()
        typed = typed[1:] if typed[0].startswith("--") else typed
        path = typed[0].split(".")[2:]
        value = coerce(entry, example_value(entry))
        settings = nest(path, [value] if entry.get("multi") else value)

        if entry["key"].endswith(".severity"):
            settings[path[0]]["above"] = 1

        sensor.parse_settings(settings)
        checked.append(entry["key"])

    assert len(checked) >= 14


def test_the_examples_of_the_test_keys_build_a_suite_parse_suite_accepts():
    suite = {"name": "unit", "env": {}, "coverage": {}}

    for entry in key_schema()["keys"]:
        if not entry["key"].startswith("tests."):
            continue

        typed = entry["example"].split()[0].split(".")
        value = coerce(entry, example_value(entry))
        path = typed[2:]
        cursor = suite

        for part in path[:-1]:
            cursor = cursor.setdefault(part, {})

        cursor[path[-1]] = value

    suite["language"] = "typescript"
    suite["runner"] = "vitest"
    suite["directory"] = "."
    suite["command"] = "pytest"
    suite["coverage"] = {"path": "coverage/lcov.info", "format": "lcov"}

    assert parse_suite(0, suite).name == "unit"


def json_type(property_schema):
    if "enum" in property_schema:
        return "enum"

    if property_schema.get("type") == "array":
        return json_type(property_schema["items"])

    kind = property_schema.get("type")

    if kind == "string" and "not" in property_schema:
        return "path"

    return kind


def expected_values(property_schema):
    if "enum" in property_schema:
        return property_schema["enum"]

    return None


def assert_key_matches(key, name, property_schema):
    assert key is not None, name

    kind = json_type(property_schema)

    if kind == "string":
        assert key["type"] in ("string", "path"), name
    else:
        assert key["type"] == kind, name

    assert (key.get("multi") is True) == (property_schema.get("type") == "array"), name

    values = expected_values(property_schema)

    if values is not None:
        assert key["values"] == values, name

    for bound in BOUNDS:
        target = (
            property_schema["items"] if property_schema.get("type") == "array" else property_schema
        )

        assert key.get(bound) == target.get(bound), (name, bound)


def test_every_test_suite_property_has_a_published_key_of_equal_type_enum_and_bounds():
    config = json.loads(CONFIG_SCHEMA.read_text())
    properties = config["properties"]["tests"]["items"]["properties"]
    keys = published()
    seen = []

    for name, schema in properties.items():
        if name == "name":
            continue

        if name == "env":
            key = keys["tests.<name>.env.<variable>"]
            assert key["type"] == "string"
            seen.append(name)

            continue

        if name == "coverage":
            for inner, inner_schema in schema["properties"].items():
                assert_key_matches(
                    keys.get(f"tests.<name>.coverage.{inner}"), f"coverage.{inner}", inner_schema
                )
                seen.append(f"coverage.{inner}")

            continue

        assert_key_matches(keys.get(f"tests.<name>.{name}"), name, schema)
        seen.append(name)

    assert len(seen) >= 8

    published_tests = {key for key in keys if key.startswith("tests.")}
    expected = {
        "tests.<name>.env.<variable>",
        *{f"tests.<name>.{name}" for name in properties if name not in ("name", "env", "coverage")},
        *{f"tests.<name>.coverage.{name}" for name in properties["coverage"]["properties"]},
    }

    assert published_tests == expected


def test_every_shipped_short_form_property_has_a_published_key_and_back():
    config = json.loads(CONFIG_SCHEMA.read_text())["properties"]["sensors"]["properties"]
    keys = published()
    seen = []

    for sensor in ("crap", "mutation"):
        short = next(
            branch
            for branch in config[sensor]["oneOf"]
            if "command" not in branch.get("properties", {})
        )

        for name, schema in short["properties"].items():
            assert_key_matches(keys.get(f"sensors.{sensor}.{name}"), f"{sensor}.{name}", schema)
            seen.append(f"{sensor}.{name}")

        owned = {key for key in keys if key.startswith(f"sensors.{sensor}.")}

        assert owned == {f"sensors.{sensor}.{name}" for name in short["properties"]}

    thresholds = next(
        branch
        for branch in config["thresholds"]["oneOf"]
        if "additionalProperties" in branch and branch["additionalProperties"] is not False
    )
    entry = next(
        branch for branch in thresholds["additionalProperties"]["oneOf"] if "properties" in branch
    )

    assert keys["sensors.thresholds.<metric>"]["values"] == ["off"]

    for name, schema in entry["properties"].items():
        assert_key_matches(keys.get(f"sensors.thresholds.<metric>.{name}"), name, schema)
        seen.append(f"thresholds.{name}")

    owned = {key for key in keys if key.startswith("sensors.thresholds.")}

    assert owned == {
        "sensors.thresholds.<metric>",
        *{f"sensors.thresholds.<metric>.{name}" for name in entry["properties"]},
    }
    assert len(seen) >= 13


def test_the_metric_placeholder_refuses_command_as_the_config_schema_does():
    pattern = re.compile(key_schema()["placeholders"]["metric"])

    assert pattern.match("complexity")
    assert not pattern.match("command")
    assert pattern.match("commands")


def test_the_schema_file_is_readable_from_a_path_outside_the_package():
    assert isinstance(KEYS_SCHEMA, Path)
    assert KEYS_SCHEMA.exists()


MUTATION_BLANK_TEXTS = {
    "sensors.mutation.max_minutes": "no time budget: the run continues until it finishes",
    "sensors.mutation.max_workers": "sized from the machine's cores and free memory",
}

PUBLISHED_DEFAULTS = {
    "sensors.crap.threshold": {"default": 30},
    "sensors.mutation.incremental": {"default": True},
    "sensors.mutation.timeout_factor": {"default": 10},
    "sensors.thresholds.<metric>.above": {"defaults": {"complexity": 10}},
    "sensors.thresholds.<metric>.below": {"defaults": {"coverage": 0.6}},
    "sensors.thresholds.<metric>.severity": {
        "defaults": {"complexity": "warning", "coverage": "warning"}
    },
}


def test_the_blank_mutation_keys_publish_default_text_and_no_default():
    for name, text in MUTATION_BLANK_TEXTS.items():
        entry = published()[name]

        assert entry["default_text"] == text
        assert "default" not in entry
        assert "defaults" not in entry


def test_the_figure_defaults_are_the_ones_the_sensors_apply():
    for name, expected in PUBLISHED_DEFAULTS.items():
        entry = published()[name]

        assert {k: entry[k] for k in ("default", "defaults") if k in entry} == expected
        assert "default_text" not in entry


def test_no_other_key_publishes_a_default():
    carrying = {
        name
        for name, entry in published().items()
        if {"default", "defaults", "default_text"} & set(entry)
    }

    assert carrying == set(PUBLISHED_DEFAULTS) | set(MUTATION_BLANK_TEXTS)


def test_no_key_carries_more_than_one_default_field():
    for entry in published().values():
        assert len({"default", "defaults", "default_text"} & set(entry)) <= 1


def test_the_pinned_sensors_schema_fixture_equals_the_published_schema():
    pinned = json.loads((REPOSITORY / "fixtures" / "sensors" / "config-keys.json").read_text())

    assert pinned == key_schema()
