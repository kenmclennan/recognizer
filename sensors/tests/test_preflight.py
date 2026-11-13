import json
import os

import pytest

from recognizer_sensors.cli import main


def repository(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()

    return root


def no_suites_gap():
    return {
        "code": "no-test-suites",
        "suite": None,
        "line": "no test suites are configured in .recognizer/config.yaml",
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

    assert main([name, "check", "--repository", str(root)]) == 0
    assert json.loads(capsys.readouterr().out) == {"gaps": [no_suites_gap()], "notes": []}


def test_the_mutation_preflight_prints_the_no_suites_gap_and_probes_nothing(
    monkeypatch, tmp_path, capsys
):
    log = tmp_path / "ran"
    shim_on_path(monkeypatch, tmp_path, log)
    root = repository(tmp_path)
    (root / "Cargo.toml").write_text("")
    before = sorted(path.name for path in root.iterdir())

    status = main(["mutation", "check", "--repository", str(root)])

    assert status == 0
    assert json.loads(capsys.readouterr().out) == {"gaps": [no_suites_gap()], "notes": []}
    assert not log.exists()
    assert sorted(path.name for path in root.iterdir()) == before
