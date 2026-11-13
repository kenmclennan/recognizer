import json
import subprocess
import sys

import pytest
from conftest import (
    REPOSITORY,
    event_lines,
    git_commit,
    make_repository,
)
from jsonschema import Draft202012Validator

from recognizer_sensors import entry
from recognizer_sensors.cli import main

CHECK_SCHEMA = REPOSITORY / "schema" / "check.schema.json"
EVENTS_SCHEMA = REPOSITORY / "schema" / "events.schema.json"
BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"


def validator(path):
    return Draft202012Validator(json.loads(path.read_text()))


@pytest.fixture
def repository(tmp_path):
    root = make_repository(tmp_path / "r", {"app/m.py": BODY})
    git_commit(root)

    return root


@pytest.mark.parametrize("name", ["crap", "mutation"])
def test_check_prints_a_document_valid_against_the_check_schema(name, repository, capsys):
    assert main([name, "check", "--repository", str(repository)]) == 0

    document = json.loads(capsys.readouterr().out)

    assert list(validator(CHECK_SCHEMA).iter_errors(document)) == []
    assert document["gaps"] != []


def test_check_on_thresholds_exits_two_and_prints_no_document(repository, capsys):
    assert main(["thresholds", "check", "--repository", str(repository)]) == 2

    captured = capsys.readouterr()

    assert captured.out == ""
    assert "no check verb" in captured.err


def test_guide_prints_text_for_crap_and_mutation_and_nothing_for_thresholds(capsys):
    outputs = {}

    for name in ("crap", "mutation", "thresholds"):
        assert main([name, "guide"]) == 0
        outputs[name] = capsys.readouterr().out

    assert outputs["crap"].strip() != ""
    assert outputs["mutation"].strip() != ""
    assert outputs["thresholds"] == ""


@pytest.mark.parametrize("flag", ["--check", "--guide"])
def test_the_old_flag_forms_exit_two_naming_the_verbs(flag, repository, capsys):
    with pytest.raises(SystemExit) as raised:
        main(["crap", flag, "--repository", str(repository)])

    assert raised.value.code == 2
    assert "run, check and guide" in capsys.readouterr().err


def test_a_sensor_name_with_no_verb_exits_two_naming_the_verbs(repository, capsys):
    assert main(["crap", "--repository", str(repository)]) == 2
    assert "run, check and guide" in capsys.readouterr().err


@pytest.mark.parametrize("argv", [["--repository", "."], ["--check"], []])
def test_the_entry_point_refuses_a_first_argument_that_is_not_a_verb(argv, capsys):
    assert entry.run("crap", argv) == 2

    err = capsys.readouterr().err

    assert "run, check and guide" in err
    assert "manifest" in err


def test_the_entry_point_passes_the_verb_through(repository, capsys):
    assert entry.crap(["check", "--repository", str(repository)]) == 0
    assert json.loads(capsys.readouterr().out)["gaps"] != []


def test_thresholds_emits_a_start_and_one_final_progress_event(repository, tmp_path, capsys):
    output = tmp_path / "out.json"

    assert (
        main(["thresholds", "run", "--repository", str(repository), "--output", str(output)]) == 0
    )

    events = event_lines(capsys.readouterr().err)

    assert events[0] == {"event": "start", "total": 1, "unit": "modules"}
    assert events[1:] == [{"event": "progress", "done": 1, "total": 1, "unit": "modules"}]

    for event in events:
        assert list(validator(EVENTS_SCHEMA).iter_errors(event)) == []


def test_a_crap_refusal_prints_a_diagnosis_event_equal_to_its_line_and_no_old_lines(
    repository, tmp_path, capsys
):
    status = main(
        [
            "crap",
            "run",
            "--repository",
            str(repository),
            "--output",
            str(tmp_path / "out.json"),
        ]
    )
    err = capsys.readouterr().err
    events = event_lines(err)

    assert status == 2
    assert [event["event"] for event in events] == ["diagnosis"]
    assert events[0]["text"] == err.splitlines()[-1]
    assert list(validator(EVENTS_SCHEMA).iter_errors(events[0])) == []
    assert "recognizer-reason" not in err
    assert "recognizer-progress" not in err


def test_a_crap_run_emits_a_start_event_counting_functions(repository, tmp_path, capsys):
    suite = {
        "name": "api",
        "language": "python",
        "directory": ".",
        "command": f"{sys.executable} -c \"import pathlib; p = pathlib.Path('c.info'); "
        "p.write_text('SF:app/m.py\\nDA:2,1\\nend_of_record\\n')\"",
        "coverage": {"path": "c.info", "format": "lcov"},
    }

    status = main(
        [
            "crap",
            "run",
            "--repository",
            str(repository),
            "--output",
            str(tmp_path / "out.json"),
            "--settings",
            json.dumps({"tests": [suite]}),
        ]
    )
    events = event_lines(capsys.readouterr().err)

    assert status == 0
    assert {"event": "note", "text": "Coverage run: api"} in events
    assert {"event": "start", "total": 1, "unit": "functions"} in events
    assert all("recognizer-" not in json.dumps(event) for event in events)


def test_the_installed_old_multiplexer_form_does_not_run(repository):
    result = subprocess.run(
        [sys.executable, "-m", "recognizer_sensors", "crap", "--check"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
