import json
import os

import pytest
from conftest import SENSOR_LIST, SHIPPED

from recognizer_sensors.cli import main

SUITE = {
    "name": "api",
    "language": "python",
    "directory": ".",
    "command": "true",
    "coverage": {"path": "coverage/lcov.info", "format": "lcov"},
}


def repository(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()

    return root


def no_suites_gap(sensor):
    return {
        "id": f"{sensor}:no-test-suites",
        "line": "no test suites are configured",
        "needs": [sensor],
        "project": None,
        "fix": {
            "text": "add a tests list to .recognizer/config.yaml",
            "command": None,
            "cwd": "",
            "env": {},
            "kind": "outside",
        },
    }


def shim_on_path(monkeypatch, tmp_path, log):
    folder = tmp_path / "bin"
    folder.mkdir()

    for name in ("cargo", "uv", "npm", "npx", "pytest"):
        script = folder / name
        script.write_text(f'#!/bin/sh\necho ran >> "{log}"\nexit 1\n')
        script.chmod(0o755)

    monkeypatch.setenv("PATH", f"{folder}{os.pathsep}{os.environ['PATH']}")


@pytest.mark.parametrize("name", ["crap", "mutation"])
def test_the_no_suites_gap_is_printed_for_each_test_running_sensor(name, tmp_path, capsys):
    root = repository(tmp_path)

    assert main([name, "--repository", str(root), "--preflight"]) == 0
    assert json.loads(capsys.readouterr().out) == {"gaps": [no_suites_gap(name)]}


def test_the_mutation_preflight_prints_the_no_suites_gap_and_probes_nothing(
    monkeypatch, tmp_path, capsys
):
    log = tmp_path / "ran"
    shim_on_path(monkeypatch, tmp_path, log)
    root = repository(tmp_path)
    (root / "Cargo.toml").write_text("")
    before = sorted(path.name for path in root.iterdir())

    status = main(["mutation", "--repository", str(root), "--preflight"])
    printed = json.loads(capsys.readouterr().out)

    assert status == 0
    assert printed == {"gaps": [no_suites_gap("mutation")]}
    assert printed["gaps"][0]["fix"]["kind"] == "outside"
    assert printed["gaps"][0]["fix"]["command"] is None
    assert not log.exists()
    assert sorted(path.name for path in root.iterdir()) == before


def test_the_crap_preflight_prints_the_no_suites_gap_and_probes_nothing(
    monkeypatch, tmp_path, capsys
):
    log = tmp_path / "ran"
    shim_on_path(monkeypatch, tmp_path, log)
    root = repository(tmp_path)
    (root / "Cargo.toml").write_text("")
    before = sorted(path.name for path in root.iterdir())

    status = main(["crap", "--repository", str(root), "--preflight"])

    assert status == 0
    assert json.loads(capsys.readouterr().out) == {"gaps": [no_suites_gap("crap")]}
    assert not log.exists()
    assert sorted(path.name for path in root.iterdir()) == before


@pytest.mark.parametrize("name", ["crap", "mutation"])
def test_the_crap_preflight_prints_no_gap_when_a_tests_list_is_set(name, tmp_path, capsys):
    root = repository(tmp_path)
    before = sorted(path.name for path in root.iterdir())

    status = main(
        [
            name,
            "--repository",
            str(root),
            "--preflight",
            "--settings",
            json.dumps({"tests": [SUITE]}),
        ]
    )

    assert status == 0
    assert json.loads(capsys.readouterr().out) == {"gaps": []}
    assert sorted(path.name for path in root.iterdir()) == before


def test_the_preflight_flag_needs_no_commit(tmp_path, capsys):
    root = repository(tmp_path)

    assert main(["duplication", "--repository", str(root), "--preflight"]) == 0
    assert json.loads(capsys.readouterr().out) == {"gaps": []}


def test_only_crap_and_mutation_probe():
    from recognizer_sensors.registry import SHIPPED as REGISTRY

    listed = json.loads(SENSOR_LIST.read_text())
    probing = sorted(name for name, sensor in REGISTRY.items() if sensor.runs_tests)

    assert probing == ["crap", "mutation"]
    assert sorted(entry["name"] for entry in listed if entry["runs_tests"]) == probing
    assert sorted(json.loads(SHIPPED.read_text())) == sorted(REGISTRY)


@pytest.mark.parametrize("name", ["duplication", "thresholds"])
def test_a_sensor_without_runs_tests_prints_no_gaps(name, tmp_path, capsys):
    root = repository(tmp_path)

    assert main([name, "--repository", str(root), "--preflight"]) == 0
    assert json.loads(capsys.readouterr().out) == {"gaps": []}
