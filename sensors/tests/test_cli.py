import json
import os
import subprocess
import sys
from importlib.metadata import version

import pytest
from conftest import (
    FINDINGS_SCHEMA,
    FIXTURE,
    REPOSITORY,
    SENSOR_LIST,
    SHIPPED,
    git_commit,
    make_repository,
    run_cli,
    write_scans,
)
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.duplication.sensor import DEFAULTS
from recognizer_sensors.registry import SHIPPED as REGISTRY


def schema_validator():
    return Draft202012Validator(json.loads(FINDINGS_SCHEMA.read_text()))


def test_a_produced_file_validates_against_the_findings_schema(sample, tmp_path):
    output = tmp_path / "out.json"

    assert run_cli(sample, output) == 0

    document = json.loads(output.read_text())

    schema_validator().validate(document)
    assert document["sensor"] == {"name": "duplication", "version": version("recognizer-sensors")}
    assert document["commit"] == "c1"
    assert document["modified"] is False
    assert document["settings"] == {"threshold": 0.82, "min_lines": 4, "min_nodes": 20}
    assert len(document["findings"]) == 2


def test_settings_reach_the_sensor_and_are_recorded(sample, tmp_path):
    output = tmp_path / "out.json"

    assert run_cli(sample, output, "--settings", '{"threshold":0.99,"min_lines":6}') == 0

    document = json.loads(output.read_text())

    assert document["settings"] == {"threshold": 0.99, "min_lines": 6, "min_nodes": 20}
    assert len(document["findings"]) == 2


def test_modified_is_true_when_any_scan_is_not_known_clean(sample, tmp_path):
    write_scans(sample, modified=None)
    output = tmp_path / "out.json"

    run_cli(sample, output)

    assert json.loads(output.read_text())["modified"] is True


def test_a_syntax_error_file_yields_findings_for_the_clean_file_only(tmp_path):
    clean = (FIXTURE / "app" / "pricing.py").read_text()
    root = make_repository(
        tmp_path / "r",
        {"clean.py": clean, "broken.py": "def f(:\n    pass\n    return (\n", "notes.txt": "x"},
    )
    output = tmp_path / "out.json"

    assert run_cli(root, output) == 0

    ids = [f["id"] for f in json.loads(output.read_text())["findings"]]

    assert ids == ["duplication:clean.py::sum_with_levy|clean.py::total_with_tax"]


def test_a_repository_with_no_scans_yields_a_valid_empty_file(tmp_path):
    root = tmp_path / "empty"
    root.mkdir()
    output = tmp_path / "out.json"

    assert run_cli(root, output) == 0

    document = json.loads(output.read_text())

    schema_validator().validate(document)
    assert document["findings"] == []
    assert document["modified"] is False


def test_an_unreadable_scan_is_no_modules(sample, tmp_path):
    (sample / ".recognizer" / "cache" / "scan.python.json").write_text("{not json")
    output = tmp_path / "out.json"

    assert run_cli(sample, output) == 0
    assert len(json.loads(output.read_text())["findings"]) == 1


@pytest.mark.parametrize(
    "argv",
    [
        ["nonesuch"],
        [],
        ["duplication", "--settings", "not json"],
        ["duplication", "--settings", "[1]"],
        ["duplication", "--settings", '{"threshold":2}'],
        ["duplication", "--settings", '{"nonesuch":1}'],
        ["duplication", "--repository", "/nonexistent/folder", "--commit", "c"],
        ["duplication", "--bogus"],
    ],
)
def test_bad_arguments_exit_two(argv, tmp_path):
    with pytest.raises(SystemExit) as raised:
        code = main([*argv, "--output", str(tmp_path / "out.json")])
        raise SystemExit(code)

    assert raised.value.code == 2
    assert not (tmp_path / "out.json").exists()


def test_no_commit_exits_two(tmp_path):
    root = tmp_path / "plain"
    root.mkdir()

    assert main(["duplication", "--repository", str(root)]) == 2


def test_the_commit_defaults_to_head(sample, tmp_path):
    sha = git_commit(sample)
    output = tmp_path / "out.json"

    assert main(["duplication", "--repository", str(sample), "--output", str(output)]) == 0
    assert json.loads(output.read_text())["commit"] == sha


def test_version_prints_the_package_version(capsys):
    with pytest.raises(SystemExit) as raised:
        main(["--version"])

    assert raised.value.code == 0
    assert capsys.readouterr().out.strip() == version("recognizer-sensors")


def test_output_goes_to_stdout_by_default(sample, capsys):
    assert main(["duplication", "--repository", str(sample), "--commit", "c1"]) == 0
    assert json.loads(capsys.readouterr().out)["sensor"]["name"] == "duplication"


def test_a_failing_run_leaves_no_file(sample, tmp_path, monkeypatch):
    output = tmp_path / "out.json"

    def explode(*_args):
        raise RuntimeError("boom")

    monkeypatch.setitem(
        REGISTRY,
        "duplication",
        type(REGISTRY["duplication"])(REGISTRY["duplication"].parse_settings, explode),
    )

    with pytest.raises(RuntimeError):
        run_cli(sample, output)

    assert not output.exists()
    assert [p.name for p in tmp_path.iterdir() if p.name.startswith(".out")] == []


def test_the_registry_equals_the_shipped_names():
    assert sorted(REGISTRY) == sorted(json.loads(SHIPPED.read_text()))


def tree_state(root):
    return {
        str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()
    }


def test_a_run_changes_nothing_in_the_repository(sample, tmp_path):
    before = tree_state(sample)

    run_cli(sample, tmp_path / "out.json")

    assert tree_state(sample) == before


def test_two_runs_give_the_same_bytes_under_another_hash_seed(sample, tmp_path):
    def run(seed, name):
        env = {**os.environ, "PYTHONHASHSEED": seed}
        subprocess.run(
            [
                sys.executable,
                "-m",
                "recognizer_sensors",
                "duplication",
                "--repository",
                str(sample),
                "--commit",
                "c1",
                "--output",
                str(tmp_path / name),
            ],
            check=True,
            env=env,
        )

        return (tmp_path / name).read_bytes()

    assert run("1", "a.json") == run("12345", "b.json")


@pytest.mark.parametrize("language", ["python", "typescript"])
def test_real_committed_content_yields_no_findings(language, tmp_path):
    root = tmp_path / language
    sample = REPOSITORY / "fixtures" / language / "sample"
    expected = json.loads((REPOSITORY / "fixtures" / language / "expected-scan.json").read_text())

    import shutil

    shutil.copytree(sample, root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    (cache / f"scan.{language}.json").write_text(json.dumps(expected))
    output = tmp_path / "out.json"

    assert run_cli(root, output) == 0
    assert json.loads(output.read_text())["findings"] == []


def test_the_registry_and_defaults_agree_with_the_sensor_list():
    listed = {entry["name"]: entry for entry in json.loads(SENSOR_LIST.read_text())}

    assert sorted(REGISTRY) == sorted(listed)
    assert listed["duplication"]["defaults"] == DEFAULTS
