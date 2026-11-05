import json
import os
import sys

import pytest
from conftest import git_commit
from test_mutation import RECORD, read, run_mutate

from recognizer_sensors import hashes as hash_module
from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.mutation.record import (
    conftests_for,
    read_record,
    recorded_entry,
    site_reusable,
    with_conftests,
)
from recognizer_sensors.mutation.runner import failed_files
from recognizer_sensors.mutation.test_files import is_test_entry


def written(root, names):
    for name in names:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# {name}\n")

    return {name: hash_module.file_sha256(root / name) for name in names}


def killed(**files):
    return {"ran": dict(files), "killer": dict(files)}


@pytest.fixture
def files(tmp_path):
    return written(tmp_path, ["tests/test_a.py", "tests/test_b.py", "tests/conftest.py"])


def test_a_killed_site_is_reused_while_its_killer_is_unchanged_and_other_tests_change(files):
    site = {"ran": dict(files), "killer": {"tests/test_a.py": files["tests/test_a.py"]}}
    current = {**files, "tests/test_b.py": "0" * 64, "tests/test_new.py": "1" * 64}

    assert site_reusable("killed", site, current, "t", frozenset(files)) is True


@pytest.mark.parametrize(
    "change",
    [
        lambda h: {**h, "tests/test_a.py": "0" * 64},
        lambda h: {**h, "tests/conftest.py": "0" * 64},
        lambda h: {k: v for k, v in h.items() if k != "tests/test_a.py"},
    ],
    ids=["killer-edited", "conftest-edited", "killer-deleted"],
)
def test_a_killed_site_reruns_when_its_killer_or_the_conftest_on_its_path_changes(files, change):
    site = killed(**{k: files[k] for k in ("tests/test_a.py", "tests/conftest.py")})

    assert site_reusable("killed", site, change(files), "t", frozenset(files)) is False


def test_a_timeout_site_reruns_when_any_ran_file_changes(files):
    site = killed(**files)

    assert site_reusable("timeout", site, files, "t", frozenset(files)) is True
    assert (
        site_reusable("timeout", site, {**files, "tests/test_b.py": "0" * 64}, "t", None) is False
    )


@pytest.mark.parametrize(
    ("current", "cover", "expected"),
    [
        ({}, {"tests/test_a.py"}, True),
        ({"tests/test_a.py": "0" * 64}, {"tests/test_a.py"}, False),
        ({"tests/test_new.py": "1" * 64}, {"tests/test_a.py", "tests/test_new.py"}, False),
        ({}, set(), True),
    ],
    ids=[
        "unchanged",
        "covering-file-edited",
        "new-covering-file",
        "recorded-file-no-longer-covers",
    ],
)
def test_a_surviving_site_reruns_only_when_a_covering_test_is_new_or_changed(
    files, current, cover, expected
):
    site = {"ran": {k: files[k] for k in ("tests/test_a.py", "tests/test_b.py")}, "killer": None}

    assert site_reusable("survived", site, {**files, **current}, "t", frozenset(cover)) is expected


def test_a_site_with_no_covering_files_is_compared_by_the_whole_tests_hash(files):
    site = {"ran": None, "killer": None, "tests": "t1"}

    assert site_reusable("killed", site, files, "t1", None) is True
    assert site_reusable("killed", site, files, "t2", None) is False


def test_a_selected_record_is_not_comparable_when_the_site_is_no_longer_selected(files):
    assert site_reusable("killed", killed(**files), files, "t", None) is False


def entry_in(record_body="b", sites=None, verdicts=None):
    verdicts = verdicts if verdicts is not None else ["killed"]
    sites = sites if sites is not None else [{"ran": None, "killer": None, "tests": "t"}]

    return {
        "record_version": 2,
        "command": "c",
        "commit": "x",
        "support": "s",
        "functions": {"f": {"body": record_body, "verdicts": verdicts, "sites": sites}},
        "skipped": [],
    }


@pytest.mark.parametrize(
    ("record", "body", "support", "usable"),
    [
        (entry_in(), "b", "s", True),
        (entry_in(), "other", "s", False),
        (entry_in(), "b", "other", False),
        (entry_in(sites=[]), "b", "s", False),
        (entry_in(sites=[None]), "b", "s", False),
        (entry_in(verdicts=[None]), "b", "s", False),
        (entry_in(verdicts=[None], sites=[None]), "b", "s", True),
        (None, "b", "s", False),
    ],
    ids=[
        "usable",
        "body-changed",
        "support-changed",
        "misaligned",
        "site-missing",
        "site-without-verdict",
        "uncovered",
        "no-record",
    ],
)
def test_a_recorded_entry_needs_matching_body_support_and_aligned_sites(
    record, body, support, usable
):
    assert (recorded_entry(record, "f", body, support) is not None) is usable


def test_a_version_one_record_is_unreadable_without_an_error(tmp_path):
    path = tmp_path / "record.json"
    path.write_text(json.dumps({**entry_in(), "record_version": 1}))

    assert read_record(path, "c") is None


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("tests/test_x.py", True),
        ("x_test.py", True),
        ("web/a.test.ts", True),
        ("web/a.spec.tsx", True),
        ("src/FooTest.kt", True),
        ("src/FooTests.cs", True),
        ("Shop.Tests/Cart.cs", True),
        ("Shop.UnitTests/Cart.cs", True),
        ("Shop.Test/Cart.cs", True),
        ("IntegrationTests/Cart.cs", True),
        ("tests/CartTests.cs", True),
        ("Shop/Cart.cs", False),
        ("src/test/kotlin/Many.kt", True),
        ("src/test/kotlin/AddTest.kt", True),
        ("src/main/kotlin/Many.kt", False),
        ("tests/conftest.py", False),
        ("tests/helpers.py", False),
        ("tests/data.json", False),
    ],
)
def test_a_test_entry_is_a_file_that_runs_tests_not_a_conftest_or_a_helper(path, expected):
    assert is_test_entry(path) is expected


def test_conftests_on_the_path_are_those_that_exist_among_the_test_files():
    known = {"conftest.py": "1", "a/b/conftest.py": "2", "a/b/test_x.py": "3", "c/conftest.py": "4"}

    assert conftests_for("a/b/test_x.py", known) == {"conftest.py", "a/b/conftest.py"}
    assert with_conftests({"a/b/test_x.py"}, known) == {
        "a/b/test_x.py",
        "conftest.py",
        "a/b/conftest.py",
    }


KNOWN = {"tests/test_x.py", "tests/test_y.py"}


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        ("FAILED tests/test_x.py::test_a - assert False\n", {"tests/test_x.py"}),
        ("ERROR tests/test_y.py\n", {"tests/test_y.py"}),
        (
            "x\nFAILED tests/test_x.py::t - a\nERROR tests/test_y.py - ImportError: no\n",
            {"tests/test_x.py", "tests/test_y.py"},
        ),
        ("FAILED other/test_z.py::t - a\n", None),
        ("FAILED tests/test_x.py::t\nFAILED other/test_z.py::t\n", None),
        ("1 failed in 0.1s\n", None),
        ("", None),
    ],
    ids=["failed", "error", "both", "unknown-path", "one-unknown", "no-line", "empty"],
)
def test_failures_are_read_from_the_runner_summary(output, expected):
    assert failed_files(output, KNOWN) == (frozenset(expected) if expected else None)


A = frozenset({"tests/test_a.py"})
B = frozenset({"tests/test_b.py"})
APP = {
    "app/one.py": "def inc(x):\n    return x + 1\n",
    "app/two.py": "def dec(x):\n    return x - 1\n",
    "app/three.py": "def dbl(x):\n    return x * 2\n",
}
CHECK = """
import os, sys
sys.path.insert(0, os.getcwd())
from app.one import inc
from app.two import dec
from app.three import dbl

assert inc(1) == 2
assert dec(1) == 0
assert dbl(2) == 4
"""
LINES = {1: 1, 2: 1}


def make_world(tmp_path, monkeypatch, selection, coverage=None):
    root = tmp_path / "w"

    for name, text in {**APP, "tests/check.py": CHECK}.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)

    written(root, ["tests/test_a.py", "tests/test_b.py", "tests/test_c.py"])
    git_commit(root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    (cache / "scan.python.json").write_text(
        json.dumps(
            {
                "files": [{"path": p, "hash": "0" * 64} for p in APP],
                "modules": [{"id": p} for p in APP],
                "modified": False,
            }
        )
    )
    state = {"selection": selection, "coverage": coverage or {p: dict(LINES) for p in APP}}
    monkeypatch.setattr(
        sensor,
        "collect_coverage_with_tests",
        lambda repository, scans, coverage: (state["coverage"], state["selection"]),
    )
    mutants = []
    real = runner.run_test_command

    def spy(command, cwd, timeout):
        result = real([sys.executable, "tests/check.py"], cwd, timeout)

        if timeout is None:
            return result

        mutants.append(list(command))

        if result.passed or result.timed_out:
            return result

        return runner.TestRun(
            result.exit_code, False, result.seconds, f"FAILED {command[-1]}::t - x\n"
        )

    monkeypatch.setattr(runner, "run_test_command", spy)
    monkeypatch.setattr(sensor, "run_test_command", spy)

    return root, state, mutants


def selection_of(**by_file):
    return {f"app/{name}.py": {2: files} for name, files in by_file.items()}


def scope(tmp_path, modules):
    path = tmp_path / "modules.json"
    path.write_text(json.dumps(modules))

    return ["--modules", str(path)]


def go(root, tmp_path, *extra):
    return run_mutate(root, tmp_path / "overlay.json", json.dumps({"max_workers": 1}), *extra)


def sites_of(root, identity):
    return read(root / RECORD)["functions"][identity]["sites"]


def test_a_record_names_the_files_that_ran_and_the_files_that_killed_each_site(
    tmp_path, monkeypatch
):
    root, _, mutants = make_world(tmp_path, monkeypatch, selection_of(one=A, two=B, three=A))

    assert go(root, tmp_path) == 0

    record = read(root / RECORD)
    a_hash = hash_module.file_sha256(root / "tests/test_a.py")
    [site] = record["functions"]["app/one.py::inc"]["sites"]

    assert record["record_version"] == 2
    assert site == {"ran": {"tests/test_a.py": a_hash}, "killer": {"tests/test_a.py": a_hash}}
    assert len(mutants) == 3
    assert all(command[-2:] == ["-rfE", command[-1]] for command in mutants)


def test_an_unrelated_test_edit_reruns_no_mutant_and_a_killer_edit_reruns_its_sites(
    tmp_path, monkeypatch
):
    root, _, mutants = make_world(tmp_path, monkeypatch, selection_of(one=A, two=B, three=A))

    assert go(root, tmp_path) == 0
    mutants.clear()
    (root / "tests/test_c.py").write_text("x = 2\n")

    assert go(root, tmp_path) == 0
    assert mutants == []

    (root / "tests/test_a.py").write_text("x = 3\n")

    assert go(root, tmp_path) == 0
    assert len(mutants) == 2
    assert all(command[-1] == "tests/test_a.py" for command in mutants)


def test_a_kotlin_test_file_edit_reruns_only_the_sites_it_covers(tmp_path, monkeypatch):
    many = frozenset({"tests/ManyTest.kt", "tests/AddTest.kt"})
    add = frozenset({"tests/AddTest.kt"})
    root, _, mutants = make_world(tmp_path, monkeypatch, selection_of(one=add, two=many, three=add))
    written(root, ["tests/ManyTest.kt", "tests/AddTest.kt"])

    assert go(root, tmp_path) == 0
    mutants.clear()
    (root / "tests/ManyTest.kt").write_text("class MulTest\n")

    assert go(root, tmp_path) == 0
    assert len(mutants) == 1
    assert sites_of(root, "app/one.py::inc")[0]["ran"] is not None
    assert "tests/ManyTest.kt" in sites_of(root, "app/two.py::dec")[0]["ran"]


def test_a_touched_killer_with_unchanged_bytes_is_reused_and_a_one_byte_edit_reruns(
    tmp_path, monkeypatch
):
    root, _, mutants = make_world(tmp_path, monkeypatch, selection_of(one=A, two=B, three=A))

    assert go(root, tmp_path) == 0
    mutants.clear()
    killer = root / "tests/test_a.py"
    os.utime(killer, (1, 1))

    assert go(root, tmp_path) == 0
    assert mutants == []

    killer.write_text(killer.read_text() + " ")

    assert go(root, tmp_path) == 0
    assert len(mutants) == 2


def test_a_function_with_one_failing_site_runs_that_mutant_and_keeps_the_others(
    tmp_path, monkeypatch
):
    root, state, mutants = make_world(tmp_path, monkeypatch, selection_of(one=A, two=B, three=A))
    (root / "app/one.py").write_text("def inc(x):\n    return x + 1 + x - x\n")
    (root / "tests/check.py").write_text(CHECK)

    assert go(root, tmp_path) == 0

    sites = read(root / RECORD)["functions"]["app/one.py::inc"]["sites"]

    assert len(sites) > 1
    mutants.clear()
    (root / "tests/test_a.py").write_text("x = 9\n")
    state["selection"] = selection_of(one=A, two=B, three=A)
    state["selection"]["app/one.py"] = {2: A}

    assert go(root, tmp_path) == 0
    assert len(mutants) == len(sites) + 1


def test_a_newly_covered_site_runs_once_and_the_rest_are_reused(tmp_path, monkeypatch):
    uncovered = {p: dict(LINES) for p in APP}
    uncovered["app/three.py"] = {1: 1, 2: 0}
    root, state, mutants = make_world(
        tmp_path, monkeypatch, selection_of(one=A, two=B, three=A), uncovered
    )

    assert go(root, tmp_path) == 0
    assert len(mutants) == 2
    assert sites_of(root, "app/three.py::dbl") == [None]
    mutants.clear()
    state["coverage"] = {p: dict(LINES) for p in APP}

    assert go(root, tmp_path) == 0
    assert len(mutants) == 1
    assert sites_of(root, "app/three.py::dbl")[0]["ran"] is not None


def test_a_covering_test_added_to_a_survivor_reruns_it(tmp_path, monkeypatch):
    root, state, mutants = make_world(tmp_path, monkeypatch, selection_of(one=A, two=B, three=A))
    (root / "tests/check.py").write_text(CHECK.replace("assert dbl(2) == 4", "assert True"))

    assert go(root, tmp_path) == 0
    assert read(root / RECORD)["functions"]["app/three.py::dbl"]["verdicts"] == ["survived"]
    mutants.clear()
    assert go(root, tmp_path) == 0
    assert mutants == []

    state["selection"] = selection_of(one=A, two=B, three=frozenset(A | B))

    assert go(root, tmp_path) == 0
    assert len(mutants) == 1


def test_scoped_and_unscoped_runs_apply_the_same_rule(tmp_path, monkeypatch, capsys):
    root, _, mutants = make_world(tmp_path, monkeypatch, selection_of(one=A, two=B, three=A))

    assert go(root, tmp_path) == 0
    mutants.clear()
    (root / "tests/test_b.py").write_text("x = 5\n")
    capsys.readouterr()

    assert go(root, tmp_path, *scope(tmp_path, ["app/three.py"])) == 0

    err = capsys.readouterr().err
    overlay = read(root / ".recognizer/cache/overlays/mutation.json")

    assert mutants == []
    assert "scoped to 1 modules; 1 functions carried from the record, 1 outside" in err
    assert sorted(overlay["inputs"]) == ["app/one.py", "app/three.py"]
    assert "app/two.py::dec" not in overlay["values"]["killed"]
    assert "sites reused" in err


def test_an_unscoped_run_after_a_scoped_one_runs_only_the_affected_function(tmp_path, monkeypatch):
    root, _, mutants = make_world(tmp_path, monkeypatch, selection_of(one=A, two=B, three=A))

    assert go(root, tmp_path) == 0
    mutants.clear()
    (root / "tests/test_b.py").write_text("x = 5\n")

    assert go(root, tmp_path) == 0
    assert len(mutants) == 1
    assert mutants[0][-1] == "tests/test_b.py"


def test_a_site_without_selection_reruns_after_any_test_change_and_not_otherwise(
    tmp_path, monkeypatch
):
    root, _, mutants = make_world(tmp_path, monkeypatch, {})

    assert go(root, tmp_path) == 0
    assert sites_of(root, "app/one.py::inc")[0]["ran"] is None
    mutants.clear()
    assert go(root, tmp_path) == 0
    assert mutants == []

    (root / "tests/test_c.py").write_text("x = 4\n")

    assert go(root, tmp_path) == 0
    assert len(mutants) == 3


def test_an_unreadable_failure_summary_makes_the_killer_the_whole_ran_set(tmp_path, monkeypatch):
    root, _, _ = make_world(tmp_path, monkeypatch, selection_of(one=A | B, two=B, three=A))
    real = runner.run_test_command

    def silent(command, cwd, timeout):
        result = real(command, cwd, timeout)

        return runner.TestRun(result.exit_code, result.timed_out, result.seconds, "no summary\n")

    monkeypatch.setattr(runner, "run_test_command", silent)
    monkeypatch.setattr(sensor, "run_test_command", silent)

    assert go(root, tmp_path) == 0

    [site] = sites_of(root, "app/one.py::inc")

    assert site["killer"] == site["ran"]
    assert set(site["ran"]) == {"tests/test_a.py", "tests/test_b.py"}


def test_a_shared_support_file_change_voids_every_site(tmp_path, monkeypatch):
    root, _, mutants = make_world(tmp_path, monkeypatch, selection_of(one=A, two=B, three=A))

    assert go(root, tmp_path) == 0
    mutants.clear()
    helper = root / "tests/helpers.py"
    helper.write_text("x = 1\n")

    assert go(root, tmp_path) == 0
    assert len(mutants) == 3
