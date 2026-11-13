import json
import shutil
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

import pytest
from conftest import REPOSITORY, git_commit, write_scans
from jsonschema import Draft202012Validator

from recognizer_sensors import config_schema, entry
from recognizer_sensors.cli import main
from recognizer_sensors.crap.sensor import PUBLISHED_THRESHOLD
from recognizer_sensors.manifest import INSTALL, PROTOCOL, build
from recognizer_sensors.registry import SHIPPED
from recognizer_sensors.testrun import records
from recognizer_sensors.thresholds.sensor import PUBLISHED

NAMES = ("crap", "mutation", "thresholds")
LAUNCH = "import sys; from recognizer_sensors.entry import {name}; sys.exit({name}())"


def validator() -> Draft202012Validator:
    schema = json.loads((REPOSITORY / "schema" / "manifest.schema.json").read_text())

    return Draft202012Validator(schema)


def launch(name: str, cwd: Path, *arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", LAUNCH.format(name=name), *arguments],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")


def test_protocol_equals_the_shared_protocol_file():
    shared = json.loads((REPOSITORY / "schema" / "protocol.json").read_text())

    assert shared == {"protocol": PROTOCOL}


@pytest.mark.parametrize("name", NAMES)
def test_the_manifest_verb_prints_a_valid_manifest_and_nothing_else(name, tmp_path):
    result = launch(name, tmp_path, "manifest")

    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout.endswith("\n")
    assert not result.stdout.endswith("\n\n")
    validator().validate(json.loads(result.stdout))


@pytest.mark.parametrize("name", NAMES)
def test_the_manifest_is_the_same_from_another_working_directory(name, tmp_path):
    other = tmp_path / "elsewhere"
    other.mkdir()

    assert launch(name, tmp_path, "manifest").stdout == launch(name, other, "manifest").stdout
    assert list(other.iterdir()) == []


@pytest.mark.parametrize("name", NAMES)
def test_each_entry_point_passes_version_through(name, tmp_path):
    result = launch(name, tmp_path, "--version")

    assert result.returncode == 0
    assert result.stdout.strip() == version("recognizer-sensors")


@pytest.mark.parametrize("name", NAMES)
def test_the_manifest_names_the_sensor_and_the_shared_facts(name):
    manifest = build(name)

    assert manifest["kind"] == "sensor"
    assert manifest["name"] == name
    assert manifest["protocol"] == PROTOCOL
    assert manifest["install"] == INSTALL
    assert manifest["version"] == version("recognizer-sensors")


@pytest.mark.parametrize("name", NAMES)
def test_runs_tests_and_scoped_equal_the_registry_flags(name):
    manifest = build(name)

    assert manifest["runs_tests"] is SHIPPED[name].runs_tests
    assert manifest["scoped"] is SHIPPED[name].scoped


@pytest.mark.parametrize("name", NAMES)
def test_every_shipped_sensor_has_a_description(name):
    assert build(name)["description"]


def test_only_crap_has_an_expansion():
    assert build("crap")["expansion"] == "C.R.A.P.: Change Risk Anti-Patterns."
    assert "expansion" not in build("mutation")
    assert "expansion" not in build("thresholds")


@pytest.mark.parametrize("name", NAMES)
def test_every_metric_has_a_title(name):
    for metric in build(name)["metrics"]:
        assert metric["title"]


def test_the_mutation_metric_labels_are_the_short_forms():
    labels = {metric["name"]: metric["label"] for metric in build("mutation")["metrics"]}

    assert labels == {"killed": "kill", "survived": "surv", "uncovered": "unc", "score": "mut"}


def test_published_figures_equal_the_constants_the_sensors_hold():
    published = {
        metric["name"]: metric["published"]
        for metric in build("crap")["metrics"]
        if "published" in metric
    }

    assert published["complexity"]["value"] == PUBLISHED["complexity"][1]
    assert published["coverage"]["value"] == PUBLISHED["coverage"][1]
    assert published["crap"]["value"] == PUBLISHED_THRESHOLD


def test_the_settings_are_the_config_keys_of_the_sensor_relative_to_its_section():
    keys = config_schema.key_schema()["keys"]

    for name in NAMES:
        prefix = f"sensors.{name}."
        owned = [{**k, "key": k["key"][len(prefix) :]} for k in keys if k["key"].startswith(prefix)]

        assert build(name)["settings"] == owned


def test_the_run_modes_and_time_limits_are_the_ones_the_cli_applies_today():
    assert build("crap")["long_running"] is True
    assert build("mutation")["long_running"] is True
    assert build("thresholds")["long_running"] is False
    assert build("thresholds")["time_limit_seconds"] == 60
    assert "time_limit_seconds" not in build("crap")
    assert [build(name)["check"] for name in NAMES] == [True, True, False]
    assert [build(name)["units"] for name in NAMES] == [["functions"], ["functions"], ["modules"]]


def test_a_sensor_entry_point_writes_the_findings_the_named_form_writes(tmp_path, monkeypatch):
    monkeypatch.setattr(records, "now_text", lambda: "2026-11-13T00:00:00Z")
    sample = tmp_path / "sample"
    shutil.copytree(REPOSITORY / "fixtures" / "crap" / "sample", sample)
    write_scans(sample)
    git_commit(sample)
    suites = [
        {
            "name": language,
            "language": language,
            "directory": ".",
            "command": "touch coverage/lcov.info",
            "coverage": {"path": "coverage/lcov.info", "format": "lcov"},
            **({"runner": "vitest"} if language == "typescript" else {}),
        }
        for language in ("python", "typescript")
    ]
    flags = [
        "--repository",
        str(sample),
        "--commit",
        "c1",
        "--settings",
        json.dumps({"tests": suites}),
    ]
    named = tmp_path / "named.json"
    entered = tmp_path / "entered.json"

    assert main(["crap", "run", *flags, "--output", str(named)]) == 0
    assert entry.crap(["run", *flags, "--output", str(entered)]) == 0
    assert named.read_text() == entered.read_text()
