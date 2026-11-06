import json
import shutil

import pytest
from conftest import FINDINGS_SCHEMA, REPOSITORY, git_commit, write_scans
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.settings import SettingsError
from recognizer_sensors.thresholds import sensor

FIXTURE = REPOSITORY / "fixtures" / "thresholds" / "sample"
OVERLAYS = ".recognizer/cache/overlays"


def overlay(commit, values, metrics=None, name="tool", **extra):
    declared = metrics if metrics is not None else list(values)

    return {
        "overlay_version": 1,
        "commit": commit,
        "modified": False,
        "producer": {"name": name, "version": "1"},
        "metrics": [
            {"name": m, "type": "count", "granularity": "member", "bad": "high"} for m in declared
        ],
        "values": values,
        **extra,
    }


def repository(tmp_path, files=None):
    root = tmp_path / "repo"
    root.mkdir()

    for name, text in (files or {"a.py": "x = 1\n", "b.py": "y = 2\n"}).items():
        (root / name).write_text(text)

    write_scans(root)

    return root, git_commit(root)


def install(root, name, document):
    target = root / OVERLAYS / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(document if isinstance(document, str) else json.dumps(document))


def sense(root, tmp_path, settings=None):
    output = tmp_path / "findings.json"
    code = main(
        [
            "thresholds",
            "--repository",
            str(root),
            "--output",
            str(output),
            "--settings",
            json.dumps(settings or {}),
        ]
    )

    return code, (json.loads(output.read_text()) if output.exists() else None)


def fixture_repository(tmp_path):
    root = tmp_path / "sample"
    shutil.copytree(FIXTURE / "app", root / "app")
    shutil.copytree(FIXTURE / "src", root / "src")
    write_scans(root)
    commit = git_commit(root)
    text = (FIXTURE / "overlays" / "quality.json").read_text().replace("COMMIT", commit)
    install(root, "quality.json", text)
    shutil.copy(FIXTURE / "overlays" / "stale.json", root / OVERLAYS / "stale.json")

    return root, commit


def test_the_defaults():
    assert sensor.parse_settings({}) == {
        "complexity": {"above": 10, "severity": "warning"},
        "coverage": {"below": 0.6, "severity": "warning"},
    }


def test_a_user_entry_replaces_the_default_whole():
    settings = sensor.parse_settings({"complexity": {"below": 2}})

    assert settings["complexity"] == {"below": 2, "severity": "warning"}


def test_off_removes_a_default_and_keeps_the_other():
    assert list(sensor.parse_settings({"complexity": "off"})) == ["coverage"]


def test_off_on_a_metric_without_a_default_is_accepted():
    assert "churn" not in sensor.parse_settings({"churn": "off"})


def test_the_effective_mapping_is_sorted_with_severity_filled_in():
    settings = sensor.parse_settings({"churn": {"above": 20}, "crap": {"above": 30}})

    assert list(settings) == ["churn", "complexity", "coverage", "crap"]
    assert settings["churn"]["severity"] == "warning"


@pytest.mark.parametrize(
    "raw",
    [
        {"complexity": "no"},
        {"complexity": {"above": 1, "below": 2}},
        {"complexity": {}},
        {"complexity": {"above": True}},
        {"complexity": {"above": "ten"}},
        {"complexity": {"above": float("inf")}},
        {"complexity": {"above": 1, "severity": "error"}},
        {"complexity": {"above": 1, "extra": 1}},
        {"complexity": 5},
        {"command": {"above": 1}},
        {"a:b": {"above": 1}},
        {"a/b": {"above": 1}},
    ],
)
def test_a_bad_setting_is_rejected(raw):
    with pytest.raises(SettingsError):
        sensor.parse_settings(raw)


def test_the_cli_exits_2_for_a_bad_setting(tmp_path):
    root, _ = repository(tmp_path)

    code, _ = sense(root, tmp_path, {"complexity": "no"})

    assert code == 2


def test_the_fixture_yields_the_seven_findings(tmp_path, capsys):
    root, commit = fixture_repository(tmp_path)

    code, document = sense(root, tmp_path, {"churn": {"above": 20, "severity": "violation"}})

    Draft202012Validator(json.loads(FINDINGS_SCHEMA.read_text())).validate(document)
    assert code == 0
    assert document["commit"] == commit
    assert [(f["id"], f["severity"], f["summary"]) for f in document["findings"]] == [
        (
            "thresholds:churn:app/billing.py",
            "violation",
            "app/billing.py: churn 25 is at or above 20",
        ),
        (
            "thresholds:churn:src/cart.ts",
            "violation",
            "src/cart.ts: churn 20 is at or above 20",
        ),
        (
            "thresholds:complexity:app/billing.py::price",
            "warning",
            "app/billing.py::price: complexity 14 is at or above 10",
        ),
        (
            "thresholds:complexity:app/billing.py::round_up",
            "warning",
            "app/billing.py::round_up: complexity 10 is at or above 10",
        ),
        (
            "thresholds:complexity:src/cart.ts::Cart.total",
            "warning",
            "src/cart.ts::Cart.total: complexity 11 is at or above 10",
        ),
        (
            "thresholds:coverage:app/billing.py::price",
            "warning",
            "app/billing.py::price: coverage 0.5 is below 0.6",
        ),
        (
            "thresholds:coverage:app/billing.py::tidy",
            "warning",
            "app/billing.py::tidy: coverage 0.59 is below 0.6",
        ),
    ]

    price = document["findings"][2]

    assert price["kind"] == "thresholds.complexity"
    assert price["principle"] == "functions-stay-small"
    assert price["metric"] == "complexity"
    assert price["evidence"] == {
        "modules": ["app/billing.py"],
        "members": [{"module": "app/billing.py", "name": "price"}],
        "measures": {"value": 14, "line": 10},
        "producer": "quality-tool",
    }
    assert document["findings"][5]["principle"] == "tests-cover-the-code"
    assert document["findings"][0]["principle"] == "churn"

    err = capsys.readouterr().err

    assert "overlay stale.json is from commit" in err
    assert "1 ids of complexity in quality.json match no scanned module" in err


def test_a_higher_complexity_line_and_off_drop_the_complexity_findings(tmp_path):
    root, _ = fixture_repository(tmp_path)

    for settings in ({"complexity": {"above": 15}}, {"complexity": "off"}):
        _, document = sense(root, tmp_path, settings)
        ids = [f["id"] for f in document["findings"]]

        assert not [i for i in ids if i.startswith("thresholds:complexity:")]
        assert len([i for i in ids if i.startswith("thresholds:coverage:")]) == 2


def test_a_boolean_value_is_skipped(tmp_path):
    root, commit = repository(tmp_path)
    install(root, "t.json", overlay(commit, {"complexity": {"a.py": True, "b.py": 12}}))

    _, document = sense(root, tmp_path)

    assert [f["id"] for f in document["findings"]] == ["thresholds:complexity:b.py"]


def test_unreadable_and_wrong_shape_overlays_are_skipped(tmp_path, capsys):
    root, commit = repository(tmp_path)
    install(root, "a-bad.json", "not json")
    install(root, "b-shape.json", {"overlay_version": 3})
    install(root, "c-good.json", overlay(commit, {"complexity": {"a.py": 12}}))

    code, document = sense(root, tmp_path)

    assert code == 0
    assert len(document["findings"]) == 1
    assert capsys.readouterr().err.count("is unreadable; skipped") == 2


def test_the_first_overlay_by_file_name_wins(tmp_path):
    root, commit = repository(tmp_path)
    install(root, "a.json", overlay(commit, {"complexity": {"a.py": 11}}))
    install(root, "b.json", overlay(commit, {"complexity": {"a.py": 50, "b.py": 50}}, name="other"))

    _, document = sense(root, tmp_path)

    assert [(f["id"], f["evidence"]["measures"]["value"]) for f in document["findings"]] == [
        ("thresholds:complexity:a.py", 11)
    ]


def test_a_metric_in_values_but_not_declared_is_not_judged(tmp_path):
    root, commit = repository(tmp_path)
    install(root, "t.json", overlay(commit, {"complexity": {"a.py": 50}}, metrics=[]))

    _, document = sense(root, tmp_path)

    assert document["findings"] == []


def test_a_missing_overlay_folder_is_silent_for_defaults(tmp_path, capsys):
    root, _ = repository(tmp_path)

    code, document = sense(root, tmp_path)

    assert code == 0
    assert document["findings"] == []
    assert capsys.readouterr().err == ""


def test_off_on_an_absent_metric_prints_nothing(tmp_path, capsys):
    root, _ = repository(tmp_path)

    sense(root, tmp_path, {"churn": "off"})

    assert capsys.readouterr().err == ""


def test_a_named_metric_in_no_overlay_prints_its_line(tmp_path, capsys):
    root, _ = repository(tmp_path)

    sense(root, tmp_path, {"churn": {"above": 1}})

    assert "metric churn is in no current overlay" in capsys.readouterr().err


def test_keys_resolve_to_modules_and_members(tmp_path, capsys):
    root, commit = repository(tmp_path)
    values = {"complexity": {"a.py": 20, "a.py::C.m": 21, "b.py::f@12": 22, "gone.py::g": 23}}
    install(root, "t.json", overlay(commit, values))

    _, document = sense(root, tmp_path)

    by_id = {f["id"]: f["evidence"] for f in document["findings"]}

    assert sorted(by_id) == [
        "thresholds:complexity:a.py",
        "thresholds:complexity:a.py::C.m",
        "thresholds:complexity:b.py::f@12",
    ]
    assert "members" not in by_id["thresholds:complexity:a.py"]
    assert by_id["thresholds:complexity:a.py::C.m"]["members"] == [
        {"module": "a.py", "name": "C.m"}
    ]
    assert by_id["thresholds:complexity:b.py::f@12"]["members"][0]["name"] == "f@12"
    assert "1 ids of complexity in t.json match no scanned module" in capsys.readouterr().err


def test_all_resolved_and_none_resolved(tmp_path, capsys):
    root, commit = repository(tmp_path)
    install(root, "t.json", overlay(commit, {"complexity": {"a.py": 20}}))
    sense(root, tmp_path)

    assert capsys.readouterr().err == ""

    install(root, "t.json", overlay(commit, {"complexity": {"x.py": 20, "y.py": 20}}))
    _, document = sense(root, tmp_path)

    assert document["findings"] == []
    assert "2 ids of complexity" in capsys.readouterr().err


def test_a_below_line_does_not_fire_on_the_line_and_a_violation_is_carried(tmp_path):
    root, commit = repository(tmp_path)
    install(root, "t.json", overlay(commit, {"score": {"a.py": 0.5, "b.py": 0.4}}))

    _, document = sense(root, tmp_path, {"score": {"below": 0.5, "severity": "violation"}})

    assert [(f["id"], f["severity"]) for f in document["findings"]] == [
        ("thresholds:score:b.py", "violation")
    ]


def test_modified_follows_the_scans(tmp_path):
    root, _ = repository(tmp_path)
    write_scans(root, modified=True)

    _, document = sense(root, tmp_path)

    assert document["modified"] is True


def test_a_run_writes_only_the_findings_file_and_is_deterministic(tmp_path):
    root, _ = fixture_repository(tmp_path)

    def state():
        return {
            str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()
        }

    before = state()
    sense(root, tmp_path)
    first = (tmp_path / "findings.json").read_bytes()
    sense(root, tmp_path)

    assert (tmp_path / "findings.json").read_bytes() == first
    assert state() == before


def test_an_overlay_written_after_a_first_run_is_judged_by_the_second(tmp_path):
    root, commit = repository(tmp_path)

    _, first = sense(root, tmp_path)
    install(root, "crap.json", overlay(commit, {"complexity": {"a.py::f": 40}}))
    _, second = sense(root, tmp_path)

    assert first["findings"] == []
    assert [f["id"] for f in second["findings"]] == ["thresholds:complexity:a.py::f"]


def test_a_function_absent_from_the_overlay_is_not_judged(tmp_path):
    root, commit = repository(tmp_path)
    install(root, "t.json", overlay(commit, {"complexity": {"b.py": 99}}))

    _, document = sense(root, tmp_path)

    assert [f["id"] for f in document["findings"]] == ["thresholds:complexity:b.py"]


def thresholds_repo(tmp_path, **extra):
    root, commit = repository(tmp_path)
    (root / "tests").mkdir()
    (root / "tests" / "test_a.py").write_text("def test_a():\n    pass\n")
    install(
        root,
        "tool.json",
        overlay(commit, {"complexity": {"a.py::f": 99, "ghost.py::g": 99}}, **extra),
    )

    return root


def current_tests(root):
    from recognizer_sensors.hashes import tests_hash

    return tests_hash(root, [])


def test_inputs_hold_only_the_modules_that_resolved(tmp_path, capsys):
    root = thresholds_repo(tmp_path)

    code, document = sense(root, tmp_path)

    assert code == 0
    assert document["findings_version"] == 2
    assert list(document["inputs"]) == ["a.py"]
    assert "tests" not in document


def test_an_overlay_with_matching_tests_is_kept_and_its_tests_hash_is_written(tmp_path):
    root = thresholds_repo(tmp_path)
    tests = current_tests(root)
    commit = json.loads((root / OVERLAYS / "tool.json").read_text())["commit"]
    install(
        root,
        "tool.json",
        overlay(commit, {"complexity": {"a.py::f": 99}}, inputs={}, tests=tests),
    )

    code, document = sense(root, tmp_path)

    assert code == 0
    assert len(document["findings"]) == 1
    assert document["tests"] == tests


def test_an_overlay_with_different_tests_is_skipped_and_named_on_stderr(tmp_path, capsys):
    root = thresholds_repo(tmp_path, inputs={}, tests="e" * 64)

    code, document = sense(root, tmp_path)

    assert code == 0
    assert document["findings"] == []
    assert "tool.json" in capsys.readouterr().err
    assert "tests" not in document


def test_an_overlay_with_no_tests_is_never_skipped_on_that_ground(tmp_path):
    root = thresholds_repo(tmp_path)

    code, document = sense(root, tmp_path)

    assert code == 0
    assert len(document["findings"]) == 1


@pytest.mark.parametrize("version", [1, 2])
def test_a_version_one_and_a_version_two_overlay_both_produce_findings(tmp_path, version):
    root = thresholds_repo(tmp_path, inputs={})
    path = root / OVERLAYS / "tool.json"
    document = json.loads(path.read_text())
    document["overlay_version"] = version
    path.write_text(json.dumps(document))

    code, result = sense(root, tmp_path)

    assert code == 0
    assert len(result["findings"]) == 1


@pytest.mark.parametrize("producer", ["crap", "mutation"])
def test_an_in_file_test_edit_makes_an_overlay_with_the_old_digest_skipped(
    tmp_path, capsys, producer
):
    root, commit = repository(tmp_path)
    (root / "src").mkdir()
    (root / "src" / "lib.rs").write_text("#[test]\nfn t() {}\n")
    old = current_tests(root)

    (root / "src" / "lib.rs").write_text("#[test]\nfn t() { assert!(true); }\n")

    new = current_tests(root)

    assert new != old

    install(
        root,
        "old.json",
        overlay(commit, {"complexity": {"a.py::f": 99}}, name=producer, inputs={}, tests=old),
    )
    code, document = sense(root, tmp_path)

    assert code == 0
    assert document["findings"] == []
    assert "old.json" in capsys.readouterr().err

    install(
        root,
        "old.json",
        overlay(commit, {"complexity": {"a.py::f": 99}}, name=producer, inputs={}, tests=new),
    )
    _, document = sense(root, tmp_path)

    assert len(document["findings"]) == 1
