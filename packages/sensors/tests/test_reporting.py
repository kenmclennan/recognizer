import json
import signal

import pytest
from conftest import event_lines, make_repository

from recognizer_sensors import cli
from recognizer_sensors.outcome import Outcome, Overlay
from recognizer_sensors.registry import Sensor

METRICS = [{"name": "crap", "type": "number", "granularity": "member", "bad": "high"}]


def finding(id_: str, summary: str = "risky") -> dict:
    return {
        "id": id_,
        "kind": "crap",
        "severity": "warning",
        "principle": "change-risk-anti-patterns",
        "summary": summary,
        "evidence": {"modules": ["a.py"]},
    }


def outcome(findings: list[dict], values: dict, tmp_path, **extra) -> Outcome:
    return Outcome(
        findings=findings,
        overlay=Overlay(METRICS, {"crap": values}, tmp_path / "overlay.json"),
        measured=len(findings),
        total=2,
        **extra,
    )


def install(monkeypatch, run, checkpoints: bool = False) -> None:
    monkeypatch.setitem(
        cli.SHIPPED,
        "fake",
        Sensor(lambda raw: raw, run, runs_tests=False, checkpoints=checkpoints),
    )


@pytest.fixture
def root(tmp_path):
    return make_repository(tmp_path / "repo", {"a.py": "x = 1\n"})


def arguments(root, *extra):
    return ["fake", "run", "--repository", str(root), "--commit", "c1", *extra]


def test_reporting_mode_writes_no_document_and_no_overlay(root, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("RECOGNIZER_PROTOCOL", "4")
    install(monkeypatch, lambda *a, **k: outcome([finding("crap:a")], {"a": 1.0}, tmp_path))
    output = tmp_path / "fake.json"

    assert cli.main(arguments(root, "--output", str(output))) == 0

    captured = capsys.readouterr()

    assert not output.exists()
    assert not (tmp_path / "overlay.json").exists()
    assert captured.out == ""
    assert [line["event"] for line in event_lines(captured.err)] == ["result", "settled"]


def test_standalone_mode_without_the_variable_writes_as_before(root, tmp_path, monkeypatch, capsys):
    install(monkeypatch, lambda *a, **k: outcome([finding("crap:a")], {"a": 1.0}, tmp_path))
    output = tmp_path / "fake.json"

    assert cli.main(arguments(root, "--output", str(output))) == 0

    assert json.loads(output.read_text())["findings"][0]["id"] == "crap:a"
    assert (tmp_path / "overlay.json").exists()
    assert event_lines(capsys.readouterr().err) == []


@pytest.mark.parametrize("value", ["3", "0", ""])
def test_a_variable_below_four_is_standalone(value, root, tmp_path, monkeypatch):
    monkeypatch.setenv("RECOGNIZER_PROTOCOL", value)
    install(monkeypatch, lambda *a, **k: outcome([finding("crap:a")], {"a": 1.0}, tmp_path))
    output = tmp_path / "fake.json"

    assert cli.main(arguments(root, "--output", str(output))) == 0
    assert output.exists()


def test_a_non_numeric_variable_is_standalone(root, tmp_path, monkeypatch):
    monkeypatch.setenv("RECOGNIZER_PROTOCOL", "four")
    install(monkeypatch, lambda *a, **k: outcome([finding("crap:a")], {"a": 1.0}, tmp_path))
    output = tmp_path / "fake.json"

    assert cli.main(arguments(root, "--output", str(output))) == 0
    assert output.exists()


def test_crap_reports_one_result_then_settled(root, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("RECOGNIZER_PROTOCOL", "4")
    install(
        monkeypatch,
        lambda *a, **k: outcome(
            [finding("crap:a"), finding("crap:b")], {"a": 1.0, "b": 2.0}, tmp_path
        ),
    )

    assert cli.main(arguments(root)) == 0

    lines = event_lines(capsys.readouterr().err)

    assert [line["event"] for line in lines] == ["result", "settled"]
    assert [one["id"] for one in lines[0]["findings"]] == ["crap:a", "crap:b"]
    assert lines[0]["overlay"] == {"crap": {"a": 1.0, "b": 2.0}}
    assert lines[1]["counts"] == {"measured": 2, "total": 2}
    assert lines[1]["modified"] is False


def test_mutation_reports_only_what_changed_at_each_checkpoint(root, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("RECOGNIZER_PROTOCOL", "4")

    def run(*args, checkpoint=None, **kwargs):
        checkpoint(outcome([finding("crap:a")], {"a": 1.0}, tmp_path))

        return outcome(
            [finding("crap:a"), finding("crap:b"), finding("crap:c", "changed")],
            {"a": 1.0, "b": 2.0, "c": 3.0},
            tmp_path,
        )

    install(monkeypatch, run, checkpoints=True)

    assert cli.main(arguments(root)) == 0

    lines = event_lines(capsys.readouterr().err)
    results = [line for line in lines if line["event"] == "result"]

    assert [line["event"] for line in lines] == ["result", "settled", "result", "settled"]
    assert [one["id"] for one in results[1]["findings"]] == ["crap:b", "crap:c"]
    assert results[1]["overlay"] == {"crap": {"b": 2.0, "c": 3.0}}


def test_a_resend_of_an_unchanged_entry_is_never_made(root, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("RECOGNIZER_PROTOCOL", "4")

    def run(*args, checkpoint=None, **kwargs):
        checkpoint(outcome([finding("crap:a")], {"a": 1.0}, tmp_path))

        return outcome([finding("crap:a")], {"a": 1.0}, tmp_path)

    install(monkeypatch, run, checkpoints=True)

    assert cli.main(arguments(root)) == 0

    lines = event_lines(capsys.readouterr().err)

    assert [line["event"] for line in lines] == ["result", "settled", "settled"]


def test_a_stopped_mutation_sends_a_stopped_settled_before_exit(
    root, tmp_path, monkeypatch, capsys
):
    monkeypatch.setenv("RECOGNIZER_PROTOCOL", "4")
    install(
        monkeypatch,
        lambda *a, **k: outcome([finding("crap:a")], {"a": 1.0}, tmp_path, stopped=True),
    )

    status = cli.main(arguments(root))
    lines = event_lines(capsys.readouterr().err)

    assert status == 128 + signal.SIGTERM
    assert lines[-1]["event"] == "settled"
    assert lines[-1]["stopped"] == {"measured": 1, "total": 2}
