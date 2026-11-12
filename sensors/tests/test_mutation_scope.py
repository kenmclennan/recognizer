import json
import os
import shutil
import subprocess
import sys

import pytest
from conftest import MUTATE_FIXTURE, git_commit, shim_suite, suite_settings

from recognizer_sensors import hashes
from recognizer_sensors.cli import main

RECORD = ".recognizer/cache/mutation/record.json"
OVERLAY = ".recognizer/cache/overlays/mutation.json"
SURVIVORS = ".recognizer/cache/mutation/survivors.json"
COVERAGE = "coverage/lcov.info"

SECOND = "def double(x):\n    return x * 2\n\n\ndef offset(x):\n    return x + 10\n"

LCOV_SECOND = "SF:app/second.py\nDA:1,1\nDA:2,1\nDA:5,1\nDA:6,1\nend_of_record\n"

STRONG_SECOND = """
from app.second import double, offset

assert double(3) == 6
assert double(0) == 0
assert offset(1) == 11
assert offset(0) == 10
"""

COUNTING_SCRIPT = """
import os, runpy, sys
with open(os.environ["RUN_LOG"], "a") as log:
    log.write("run\\n")
runpy.run_path(os.path.join(os.getcwd(), "tests", "strong.py"), run_name="__main__")
"""


@pytest.fixture
def two_modules(tmp_path, monkeypatch):
    root = tmp_path / "sample"
    shutil.copytree(MUTATE_FIXTURE, root, ignore=shutil.ignore_patterns("scan.python.json"))
    (root / "app" / "second.py").write_text(SECOND)
    strong = root / "tests" / "strong.py"
    strong.write_text(strong.read_text() + STRONG_SECOND)
    lcov = root / COVERAGE
    lcov.write_text(lcov.read_text() + LCOV_SECOND)
    commit = git_commit(root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    (cache / "scan.python.json").write_text(
        json.dumps(
            {
                "files": [
                    {"path": "app/rules.py", "hash": "0" * 64},
                    {"path": "app/second.py", "hash": "0" * 64},
                ],
                "modules": [{"id": "app/rules.py"}, {"id": "app/second.py"}],
                "modified": False,
            }
        )
    )
    script = tmp_path / "counting.py"
    script.write_text(COUNTING_SCRIPT)
    log = tmp_path / "runs.log"
    monkeypatch.setenv("RUN_LOG", str(log))

    return root, commit, script, log


def settings_for(script, **extra):
    return suite_settings([sys.executable, str(script)], max_workers=1, **extra)


def scope_file(tmp_path, modules):
    path = tmp_path / "modules.json"
    path.write_text(json.dumps(modules))

    return str(path)


def mutate(root, tmp_path, settings, modules=None):
    extra = [] if modules is None else ["--modules", scope_file(tmp_path, modules)]

    return main(
        [
            "mutation",
            "--repository",
            str(root),
            "--output",
            str(tmp_path / "findings.json"),
            "--settings",
            settings,
            *extra,
        ]
    )


def read(root, name):
    return json.loads((root / name).read_text())


def runs(log):
    return len(log.read_text().splitlines()) if log.exists() else 0


def git_run(root, *args):
    env = {
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
        "PATH": os.environ["PATH"],
    }
    subprocess.run(["git", "-C", str(root), *args], check=True, env=env, capture_output=True)


def test_a_scoped_run_mutates_only_the_scope_and_carries_the_rest(two_modules, tmp_path, capsys):
    root, commit, script, log = two_modules
    settings = settings_for(script)

    assert mutate(root, tmp_path, settings) == 0
    full = read(root, OVERLAY)
    full_runs = runs(log)
    rules = root / "app" / "rules.py"
    rules.write_text(rules.read_text().replace("return a and b", "return b and a"))
    second = root / "app" / "second.py"
    second.write_text(second.read_text().replace("x * 2", "2 * x"))
    capsys.readouterr()

    assert mutate(root, tmp_path, settings, ["app/second.py"]) == 0

    err = capsys.readouterr().err
    overlay = read(root, OVERLAY)

    assert "2 functions carried from the record, 1 outside the scope have no result" in err
    assert runs(log) < 2 * full_runs
    assert "app/second.py::double" in overlay["values"]["killed"]
    assert "app/rules.py::both" not in overlay["values"]["killed"]
    assert "app/rules.py::grade" in overlay["values"]["killed"]
    assert read(root, RECORD)["commit"] == commit
    assert overlay["values"]["killed"]["app/rules.py::grade"] == 2
    assert "app/rules.py::both" in full["values"]["killed"]


def test_out_of_scope_results_survive_in_every_output(two_modules, tmp_path, capsys):
    root, commit, script, log = two_modules
    settings = settings_for(script)

    assert mutate(root, tmp_path, settings) == 0
    full = read(root, OVERLAY)
    before = runs(log)
    capsys.readouterr()

    assert mutate(root, tmp_path, settings, ["app/second.py"]) == 0

    err = capsys.readouterr().err
    scoped = read(root, OVERLAY)

    assert scoped["values"] == full["values"]
    assert "3 functions carried" in err
    assert runs(log) == before
    assert set(read(root, RECORD)["functions"]) == set(full["values"]["killed"])
    assert read(root, SURVIVORS)["complete"] is True


@pytest.mark.usefixtures("unprimed")
def test_a_scoped_run_mutates_only_in_scope_changed_functions(two_modules, tmp_path):
    root, _, script, log = two_modules
    settings = settings_for(script)

    assert mutate(root, tmp_path, settings) == 0
    second = root / "app" / "second.py"
    second.write_text(second.read_text().replace("x * 2", "2 * x"))
    before = runs(log)

    assert mutate(root, tmp_path, settings, ["app/second.py"]) == 0

    spent = runs(log) - before

    assert spent >= 2
    assert spent < 2 + 4


def test_a_function_with_no_usable_record_is_absent_and_reported_partial(two_modules, tmp_path):
    root, _, script, _ = two_modules
    settings = settings_for(script)

    assert mutate(root, tmp_path, settings, ["app/second.py"]) == 0

    overlay = read(root, OVERLAY)
    findings = json.loads((tmp_path / "findings.json").read_text())

    assert set(overlay["values"]["killed"]) == {"app/second.py::double", "app/second.py::offset"}
    assert findings["partial"] == {"measured": 2, "total": 5}
    assert set(read(root, RECORD)["functions"]) == set(overlay["values"]["killed"])


def test_incremental_false_still_carries(two_modules, tmp_path):
    root, _, script, _ = two_modules

    assert mutate(root, tmp_path, settings_for(script)) == 0

    full = read(root, OVERLAY)

    assert mutate(root, tmp_path, settings_for(script, incremental=False), ["app/second.py"]) == 0
    assert read(root, OVERLAY)["values"]["killed"].keys() == full["values"]["killed"].keys()


def test_a_test_change_reruns_only_the_affected_sites_in_and_out_of_scope(
    two_modules, tmp_path, capsys
):
    root, commit, script, _ = two_modules
    settings = settings_for(script)

    assert mutate(root, tmp_path, settings) == 0

    full = read(root, OVERLAY)
    (root / "conftest.py").write_text("x = 1\n")
    capsys.readouterr()

    assert mutate(root, tmp_path, settings, ["app/second.py"]) == 0

    err = capsys.readouterr().err
    scoped = read(root, OVERLAY)

    assert "test files changed" not in err
    assert "1 functions carried from the record, 2 outside the scope have no result" in err
    assert set(scoped["values"]["killed"]) == {
        "app/rules.py::total",
        "app/second.py::double",
        "app/second.py::offset",
    }
    assert (
        scoped["values"]["killed"]["app/second.py::double"]
        == (full["values"]["killed"]["app/second.py::double"])
    )
    assert read(root, RECORD)["commit"] == commit


def test_a_scope_given_to_another_sensor_is_exit_2(two_modules, tmp_path, capsys):
    root, _, _, _ = two_modules
    path = scope_file(tmp_path, ["app/second.py"])

    code = main(
        [
            "thresholds",
            "--repository",
            str(root),
            "--output",
            str(tmp_path / "d.json"),
            "--modules",
            path,
        ]
    )

    assert code == 2
    assert "thresholds takes no module scope" in capsys.readouterr().err


@pytest.mark.parametrize("text", ["not json", '{"a": 1}', '["a", ""]', "[1]"])
def test_a_malformed_scope_file_is_exit_2(two_modules, tmp_path, text):
    root, _, script, _ = two_modules
    path = tmp_path / "bad.json"
    path.write_text(text)

    code = main(
        [
            "mutation",
            "--repository",
            str(root),
            "--output",
            str(tmp_path / "f.json"),
            "--settings",
            settings_for(script),
            "--modules",
            str(path),
        ]
    )

    assert code == 2


def test_a_scoped_run_keeps_a_carried_module_in_inputs(two_modules, tmp_path):
    root, _, script, _ = two_modules
    settings = settings_for(script)

    assert mutate(root, tmp_path, settings) == 0

    full = read(root, OVERLAY)

    assert full["overlay_version"] == 2
    assert sorted(full["inputs"]) == ["app/rules.py", "app/second.py"]
    assert full["tests"] == hashes.tests_hash(root, [])

    assert mutate(root, tmp_path, settings, ["app/second.py"]) == 0

    scoped = read(root, OVERLAY)

    assert sorted(scoped["inputs"]) == ["app/rules.py", "app/second.py"]
    assert scoped["tests"] == full["tests"]


def test_the_overlay_records_the_shared_digest_with_a_lib_and_a_bin_unit(two_modules, tmp_path):
    from recognizer_sensors.mutation.commands import RUST_UNITS

    root, _, script, _ = two_modules
    (root / "src" / "bin").mkdir(parents=True)
    (root / "src" / "lib.rs").write_text("pub fn f() {}\n\n#[cfg(test)]\nmod t {}\n")
    (root / "src" / "bin" / "tool.rs").write_text("fn main() {}\n\n#[test]\nfn u() {}\n")
    git_commit(root)
    before = hashes.support_hash(hashes.test_hashes(root, []))

    RUST_UNITS.clear()
    RUST_UNITS["src/lib.rs"] = ("calc", "lib", "calc")
    RUST_UNITS["src/bin/tool.rs"] = ("calc", "bin", "tool")

    try:
        assert mutate(root, tmp_path, settings_for(script)) == 0
    finally:
        RUST_UNITS.clear()

    recorded = read(root, OVERLAY)["tests"]

    assert recorded == hashes.tests_hash(root, [])
    assert hashes.support_hash(hashes.test_hashes(root, [])) == before


def test_a_scoped_run_reports_progress_over_the_scope_only(
    two_modules, tmp_path, capsys, monkeypatch
):
    root, commit, script, log = two_modules
    settings = settings_for(script)

    assert mutate(root, tmp_path, settings) == 0

    monkeypatch.setenv("RECOGNIZER_PROGRESS", "1")
    capsys.readouterr()

    assert mutate(root, tmp_path, settings, ["app/second.py"]) == 0

    mutants = [
        json.loads(line.removeprefix("recognizer-progress "))
        for line in capsys.readouterr().err.splitlines()
        if line.startswith("recognizer-progress ")
    ]
    mutants = [line for line in mutants if line["step"] == "mutants"]

    assert mutants == [{"step": "mutants", "suite": "sample", "done": 2, "total": 2}]


WEB = "0web"

WEB_MODULE = "def inc(x):\n    return x + 1\n"

WEB_SCRIPT = """
import os, sys
with open(os.environ["RUN_LOG"], "a") as log:
    log.write("web\\n")
sys.path.insert(0, os.getcwd())
from extra import inc
assert inc(1) == 2
assert inc(0) == 1
"""


@pytest.fixture
def two_suites(two_modules, tmp_path):
    root, commit, script, log = two_modules
    web = root / WEB
    (web / "coverage").mkdir(parents=True)
    (web / "extra.py").write_text(WEB_MODULE)
    (web / "coverage" / "lcov.info").write_text("SF:extra.py\nDA:1,1\nDA:2,1\nend_of_record\n")
    web_script = tmp_path / "web_script.py"
    web_script.write_text(WEB_SCRIPT)
    scan_path = root / ".recognizer" / "cache" / "scan.python.json"
    scan = json.loads(scan_path.read_text())
    scan["files"].append({"path": f"{WEB}/extra.py", "hash": "0" * 64})
    scan["modules"].append({"id": f"{WEB}/extra.py"})
    scan_path.write_text(json.dumps(scan))
    git_run(root, "add", "-A")
    git_run(root, "commit", "-q", "-m", "web")
    settings = json.dumps(
        {
            "tests": [
                shim_suite(f"{sys.executable} {script}", name="unit"),
                shim_suite(f"{sys.executable} {web_script}", name="web", directory=WEB),
            ],
            "max_workers": 1,
        }
    )

    return root, settings, log


def mutate_suites(root, tmp_path, settings, names=None):
    extra = [] if names is None else ["--suites", json.dumps(names)]

    return main(
        [
            "mutation",
            "--repository",
            str(root),
            "--output",
            str(tmp_path / "findings.json"),
            "--settings",
            settings,
            *extra,
        ]
    )


def progress_lines(capsys):
    return [
        json.loads(line.removeprefix("recognizer-progress "))
        for line in capsys.readouterr().err.splitlines()
        if line.startswith("recognizer-progress ")
    ]


def web_identity(overlay):
    return next(k for k in overlay["values"]["killed"] if k.startswith(f"{WEB}/"))


def test_a_run_of_one_suite_carries_the_other_suites_recorded_functions(
    two_suites, tmp_path, monkeypatch, capsys
):
    root, settings, log = two_suites

    assert mutate_suites(root, tmp_path, settings) == 0

    full = read(root, OVERLAY)
    identity = web_identity(full)
    web_runs = log.read_text().splitlines().count("web")
    rules = root / "app" / "rules.py"
    rules.write_text(rules.read_text().replace("return a and b", "return b and a"))
    monkeypatch.setenv("RECOGNIZER_PROGRESS", "1")
    capsys.readouterr()

    assert mutate_suites(root, tmp_path, settings, ["unit"]) == 0

    overlay = read(root, OVERLAY)
    lines = progress_lines(capsys)
    findings = json.loads((tmp_path / "findings.json").read_text())

    assert log.read_text().splitlines().count("web") == web_runs
    assert overlay["values"]["killed"][identity] == full["values"]["killed"][identity]
    assert overlay["values"]["survived"][identity] == full["values"]["survived"][identity]
    assert {line.get("suite") for line in lines} == {"unit"}
    assert [line for line in lines if line["step"] == "coverage"] == [
        {"step": "coverage", "suite": "unit"}
    ]
    assert [s["name"] for s in findings["suites"]] == ["unit", "web"]
    assert findings["suites"][1]["status"] == "ok"
    assert findings["suites"][1]["measured"] == 1


def test_a_function_of_an_unselected_suite_with_no_record_is_absent(two_suites, tmp_path):
    root, settings, _ = two_suites

    assert mutate_suites(root, tmp_path, settings, ["unit"]) == 0

    overlay = read(root, OVERLAY)
    findings = json.loads((tmp_path / "findings.json").read_text())

    assert not any(k.startswith(f"{WEB}/") for k in overlay["values"]["killed"])
    assert overlay["values"]["killed"]
    assert findings["suites"][1] == {"name": "web", "status": "never", "ran_at": None}
    assert findings["suites"][0]["status"] == "ok"


def test_progress_counts_one_suite_at_a_time_in_config_order(
    two_suites, tmp_path, monkeypatch, capsys
):
    root, settings, _ = two_suites
    monkeypatch.setenv("RECOGNIZER_PROGRESS", "1")

    assert mutate_suites(root, tmp_path, settings) == 0

    lines = progress_lines(capsys)
    suites = [line["suite"] for line in lines if line["step"] == "coverage"]
    mutants = [line for line in lines if line["step"] == "mutants"]
    order = []

    for line in mutants:
        if line["suite"] not in order:
            order.append(line["suite"])

    unit_total = next(m["total"] for m in mutants if m["suite"] == "unit")

    assert suites == ["unit", "web"]
    assert order == ["unit", "web"]
    assert max(m["done"] for m in mutants if m["suite"] == "web") == 1
    assert unit_total == 5
