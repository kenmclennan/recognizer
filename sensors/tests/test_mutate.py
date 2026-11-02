import json
import os
import time

import pytest
from conftest import (
    MEASURERS_FILE,
    OVERLAY_SCHEMA,
    mutate_repository,
    mutate_settings,
)
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.mutate import measurer
from recognizer_sensors.settings import SettingsError

SURVIVORS = ".recognizer/cache/mutation/survivors.json"
CRAP = ".recognizer/cache/overlays/crap.json"


def run_mutate(root, output, settings, *extra):
    return main(
        [
            "mutate",
            "--repository",
            str(root),
            "--output",
            str(output),
            "--settings",
            settings,
            *extra,
        ]
    )


def read(path):
    return json.loads(path.read_text())


def row(overlay, identity):
    values = overlay["values"]

    return [values[name].get(identity) for name in ("killed", "survived", "uncovered", "score")]


def snapshot(root):
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file()
        and ".git" not in p.relative_to(root).parts
        and ".recognizer/cache/mutation" not in p.relative_to(root).as_posix()
    }


def test_weak_tests_leave_the_table_s_survivors(tmp_path):
    root, commit = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 0

    overlay = read(output)

    Draft202012Validator(read(OVERLAY_SCHEMA)).validate(overlay)
    assert overlay["commit"] == commit
    assert overlay["modified"] is False
    assert overlay["producer"]["name"] == "mutate"
    assert row(overlay, "app/rules.py::grade") == [0, 2, 0, 0.0]
    assert row(overlay, "app/rules.py::both") == [0, 1, 0, 0.0]
    assert row(overlay, "app/rules.py::total") == [0, 0, 1, None]

    survivors = read(root / SURVIVORS)

    assert survivors["commit"] == commit
    assert list(survivors["functions"]) == ["app/rules.py::both", "app/rules.py::grade"]
    assert survivors["functions"]["app/rules.py::grade"] == {
        "module": "app/rules.py",
        "name": "grade",
        "file": "app/rules.py",
        "lines": [1, 6],
        "survivors": [
            {"line": 2, "operator": ">=", "replacement": ">"},
            {"line": 4, "operator": ">=", "replacement": ">"},
        ],
    }
    assert survivors["functions"]["app/rules.py::both"]["survivors"] == [
        {"line": 10, "operator": "and", "replacement": "or"}
    ]


def test_strong_tests_kill_every_covered_mutant(tmp_path):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/strong.py")) == 0

    overlay = read(output)

    assert row(overlay, "app/rules.py::grade") == [2, 0, 0, 1.0]
    assert row(overlay, "app/rules.py::both") == [1, 0, 0, 1.0]
    assert row(overlay, "app/rules.py::total") == [0, 0, 1, None]
    assert read(root / SURVIVORS)["functions"] == {}


def test_a_hung_mutant_times_out_and_is_killed(tmp_path):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    started = time.monotonic()

    assert run_mutate(root, output, mutate_settings("tests/slow_on_mutant.py")) == 0

    overlay = read(output)

    assert time.monotonic() - started < 30
    assert row(overlay, "app/rules.py::grade") == [1, 1, 0, 0.5]
    assert row(overlay, "app/rules.py::both") == [0, 1, 0, 0.0]
    assert row(overlay, "app/rules.py::total") == [0, 0, 1, None]


def test_the_output_does_not_depend_on_max_workers(tmp_path):
    root, _ = mutate_repository(tmp_path)
    first, second = tmp_path / "one.json", tmp_path / "four.json"

    assert run_mutate(root, first, mutate_settings("tests/weak.py", max_workers=1)) == 0

    one_survivors = (root / SURVIVORS).read_bytes()

    assert run_mutate(root, second, mutate_settings("tests/weak.py", max_workers=4)) == 0
    assert first.read_bytes() == second.read_bytes()
    assert one_survivors == (root / SURVIVORS).read_bytes()


@pytest.mark.parametrize(("workers", "overlapped"), [(1, False), (2, True)])
def test_max_workers_mutants_run_at_once(tmp_path, monkeypatch, workers, overlapped):
    root, _ = mutate_repository(tmp_path)
    rendezvous = tmp_path / "rendezvous"
    rendezvous.mkdir()
    monkeypatch.setenv("RENDEZVOUS_DIR", str(rendezvous))

    assert (
        run_mutate(
            root,
            tmp_path / "overlay.json",
            mutate_settings("tests/rendezvous.py", max_workers=workers),
        )
        == 0
    )
    assert (rendezvous / "overlapped").exists() is overlapped


def test_the_real_tree_is_unchanged_and_no_copy_is_left(tmp_path):
    root, _ = mutate_repository(tmp_path)
    before = snapshot(root)

    assert run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/weak.py")) == 0
    assert snapshot(root) == before
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()


def test_a_function_without_crap_coverage_is_absent_everywhere(tmp_path):
    root, _ = mutate_repository(tmp_path)
    overlay_path = root / CRAP
    crap = read(overlay_path)
    del crap["values"]["coverage"]["app/rules.py::both"]
    crap["values"]["coverage"]["app/rules.py::ghost"] = 1.0
    overlay_path.write_text(json.dumps(crap))
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 0

    overlay = read(output)

    for name in ("killed", "survived", "uncovered", "score"):
        assert "app/rules.py::both" not in overlay["values"][name]
        assert "app/rules.py::ghost" not in overlay["values"][name]

    assert row(overlay, "app/rules.py::grade") == [0, 2, 0, 0.0]


@pytest.mark.parametrize(
    "command", [["python3", "-c", "raise SystemExit(1)"], ["/no/such/program"]]
)
def test_a_failing_or_unstartable_baseline_is_exit_two_and_writes_nothing(
    tmp_path, capsys, command
):
    root, _ = mutate_repository(tmp_path)
    output = tmp_path / "overlay.json"
    settings = json.dumps({"test_command": command})

    assert run_mutate(root, output, settings) == 2
    assert "baseline test run failed" in capsys.readouterr().err
    assert not output.exists()
    assert not (root / SURVIVORS).exists()
    assert not (root / ".recognizer" / "cache" / "mutation" / "work").exists()


def test_the_baseline_failure_shows_the_tail_of_its_output(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    script = "import sys; print('\\n'.join(str(i) for i in range(40))); sys.exit(3)"
    settings = json.dumps({"test_command": ["python3", "-c", script]})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 2

    err = capsys.readouterr().err

    assert "(exit 3)" in err
    assert "39" in err
    assert "\n19\n" not in err


def stale_crap(root, mutation):
    path = root / CRAP
    document = read(path)
    mutation(document)
    path.write_text(json.dumps(document))


@pytest.mark.parametrize(
    "mutation",
    [
        lambda d: d.update(commit="other"),
        lambda d: d["metrics"].pop(1),
        lambda d: d["values"].pop("coverage"),
    ],
    ids=["other-commit", "no-coverage-metric", "no-coverage-values"],
)
def test_a_stale_or_incomplete_crap_overlay_is_exit_two(tmp_path, capsys, mutation):
    root, _ = mutate_repository(tmp_path)
    stale_crap(root, mutation)
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 2
    assert "recognizer scan --sense crap" in capsys.readouterr().err
    assert not output.exists()
    assert not (root / SURVIVORS).exists()


def test_a_missing_crap_overlay_is_exit_two(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)
    (root / CRAP).unlink()

    assert run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/weak.py")) == 2
    assert CRAP in capsys.readouterr().err


def test_an_unreadable_lcov_file_is_exit_two(tmp_path):
    root, _ = mutate_repository(tmp_path)
    (root / "coverage" / "lcov.info").unlink()
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 2
    assert not output.exists()
    assert not (root / SURVIVORS).exists()


def test_an_uncovered_line_is_never_run(tmp_path):
    root, _ = mutate_repository(tmp_path)
    (root / "coverage" / "lcov.info").write_text(
        "SF:app/rules.py\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,0\nDA:5,0\nDA:6,0\nDA:9,1\nDA:10,1\nend_of_record\n"
    )
    output = tmp_path / "overlay.json"

    assert run_mutate(root, output, mutate_settings("tests/weak.py")) == 0
    assert row(read(output), "app/rules.py::grade") == [0, 1, 1, 0.0]


@pytest.mark.parametrize(
    "raw",
    [
        {},
        {"test_command": []},
        {"test_command": "pytest"},
        {"test_command": ["pytest", 3]},
        {"test_command": ["pytest", ""]},
        {"test_command": ["t"], "timeout_factor": 0},
        {"test_command": ["t"], "timeout_factor": -1},
        {"test_command": ["t"], "timeout_factor": "10"},
        {"test_command": ["t"], "max_workers": 0},
        {"test_command": ["t"], "max_workers": "2"},
        {"test_command": ["t"], "max_workers": 1.5},
        {"test_command": ["t"], "coverage": "/abs/lcov"},
        {"test_command": ["t"], "crap_overlay": "../crap.json"},
        {"test_command": ["t"], "survivors": ""},
        {"test_command": ["t"], "nope": 1},
    ],
)
def test_bad_settings_are_rejected(raw):
    with pytest.raises(SettingsError):
        measurer.parse_settings(raw)


def test_bad_settings_exit_two_through_the_cli(tmp_path):
    root, _ = mutate_repository(tmp_path)

    assert run_mutate(root, tmp_path / "overlay.json", "{}") == 2


def test_settings_defaults():
    settings = measurer.parse_settings({"test_command": ["t"]})

    assert settings == {
        "test_command": ["t"],
        "timeout_factor": 10.0,
        "max_workers": os.cpu_count() or 1,
        "coverage": "coverage/lcov.info",
        "crap_overlay": ".recognizer/cache/overlays/crap.json",
        "survivors": ".recognizer/cache/mutation/survivors.json",
    }


def test_the_timeout_has_a_two_second_floor():
    assert measurer.timeout_for(0.05, 10) == 2.0
    assert measurer.timeout_for(1.0, 10) == 10.0


def test_the_metric_list_equals_the_shared_file():
    assert json.loads(MEASURERS_FILE.read_text()) == {"mutate": measurer.METRICS}


def test_a_dirty_tree_is_recorded_as_modified(tmp_path):
    root, _ = mutate_repository(tmp_path)
    (root / "app" / "rules.py").write_text((root / "app" / "rules.py").read_text() + "\n")
    output = tmp_path / "overlay.json"

    run_mutate(root, output, mutate_settings("tests/weak.py"))

    assert read(output)["modified"] is True


def test_the_overlay_goes_to_stdout_without_output(tmp_path, capsys):
    root, _ = mutate_repository(tmp_path)

    assert (
        main(
            ["mutate", "--repository", str(root), "--settings", mutate_settings("tests/strong.py")]
        )
        == 0
    )
    assert json.loads(capsys.readouterr().out)["producer"]["name"] == "mutate"


def covered_target(start_line, end_line):
    return measurer.Target("id", "module", "f.py", "f", start_line, end_line)


def site_at(line, start_byte=0, end_byte=1):
    return measurer.Site(line, 0, start_byte, end_byte, "==", "!=")


def test_a_site_on_a_continuation_line_takes_the_preceding_instrumented_line():
    target = covered_target(10, 20)

    assert measurer.site_is_covered(site_at(13), target, {11: 4, 15: 0}) is True
    assert measurer.site_is_covered(site_at(16), target, {11: 4, 15: 0}) is False


def test_a_site_before_any_instrumented_line_in_its_function_is_uncovered():
    target = covered_target(10, 20)

    assert measurer.site_is_covered(site_at(11), target, {5: 3, 14: 3}) is False
    assert measurer.site_is_covered(site_at(11), target, {}) is False


def test_a_site_in_a_nested_unit_function_belongs_to_the_nested_function():
    sites = [site_at(3, 30, 32), site_at(8, 80, 82)]
    spans = [(0, 200), (50, 120)]

    owned = measurer.innermost(sites, spans)

    assert owned == {0: [sites[0]], 1: [sites[1]]}
