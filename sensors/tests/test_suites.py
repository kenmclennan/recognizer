import json
import os
import shlex
import subprocess
import sys
import time
from dataclasses import replace
from types import SimpleNamespace

import pytest
from conftest import REPOSITORY, make_repository

from recognizer_sensors.scans import Scan, ScanModule, read_scans
from recognizer_sensors.settings import Refusal, SettingsError
from recognizer_sensors.testrun import suites as suites_module
from recognizer_sensors.testrun.suites import (
    Suite,
    collect_suites,
    login_shell,
    parse_suites,
    selected,
    shell_script,
)

LOG = ".recognizer/cache/coverage/last-run.log"

BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"

LCOV_TEXT = "SF:app/m.py\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n"


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")


def raw(language="python", **overrides):
    suite = {
        "name": "api",
        "language": language,
        "directory": ".",
        "command": "true",
        "coverage": {"path": "out/lcov.info", "format": "lcov"},
    }

    if language == "typescript":
        suite["runner"] = "vitest"

    return {**suite, **overrides}


def build(tmp_path, files=None):
    return make_repository(tmp_path / "r", files or {"app/m.py": BODY})


def run(root, *items):
    return collect_suites(root, read_scans(root), parse_suites(list(items)))


def writes(path, text=LCOV_TEXT):
    return f"mkdir -p {shlex.quote(os.path.dirname(path) or '.')} && printf %s {shlex.quote(text)} > {shlex.quote(path)}"


@pytest.mark.parametrize("language", ["python", "typescript", "kotlin", "rust", "csharp"])
def test_a_valid_suite_parses_for_every_language(language):
    (suite,) = parse_suites([raw(language, activate="true", env={"A": "1"})])

    assert suite == Suite(
        "api",
        language,
        ".",
        "true",
        "true",
        {"A": "1"},
        "out/lcov.info",
        "lcov",
        "vitest" if language == "typescript" else None,
    )


@pytest.mark.parametrize(
    ("item", "needle"),
    [
        (raw("typescript", runner=None), "needs a runner"),
        (raw("python", runner="jest"), "typescript suites only"),
        (raw(coverage={"path": "x", "format": "cobertura"}), "lcov or jacoco"),
        (raw(directory="/abs"), "relative path"),
        (raw(directory="a/../../b"), "relative path"),
        (raw(language="ruby"), "language must be one of"),
        (raw(extra=1), "unknown key"),
        (raw(env={"bad name": "x"}), "env must map"),
        (raw(coverage={"path": "x"}), "coverage must hold"),
    ],
)
def test_a_bad_suite_is_refused_naming_it(item, needle):
    with pytest.raises(SettingsError) as error:
        parse_suites([item])

    assert "api" in str(error.value)
    assert needle in str(error.value)


def test_a_duplicate_suite_name_is_refused_naming_it():
    with pytest.raises(SettingsError, match="api: the name is used twice"):
        parse_suites([raw(), raw()])


def test_an_empty_list_is_refused():
    with pytest.raises(SettingsError):
        parse_suites([])


def suite_of(**overrides):
    return parse_suites([raw(**overrides)])[0]


def test_the_script_is_directory_then_activate_then_command():
    assert shell_script(suite_of(directory="svc", activate="nvm use", command="npm test")) == (
        "cd svc && nvm use && npm test"
    )


def test_the_script_omits_an_absent_activate():
    assert shell_script(suite_of(directory="svc", command="make test")) == "cd svc && make test"


def test_a_directory_with_a_space_and_a_quote_is_quoted():
    script = shell_script(suite_of(directory="my dir/it's"))

    assert script == "cd 'my dir/it'\"'\"'s' && true"


def test_the_root_directory_becomes_cd_dot():
    assert shell_script(suite_of(directory=".")).startswith("cd . && ")


def test_the_shell_falls_back_to_zsh_when_unset(monkeypatch):
    monkeypatch.delenv("SHELL")

    assert login_shell() == "/bin/zsh"


def test_a_suite_runs_from_its_directory_with_its_env_and_activate_before_command(tmp_path):
    root = build(tmp_path)
    (root / "svc").mkdir()
    command = (
        'printf "%s|%s|%s" "$(pwd)" "$SUITE_VAR" "$ACTIVATED" > seen.txt; echo hello-from-suite; '
        + writes("out/lcov.info")
    )
    item = raw(
        directory="svc",
        activate="export ACTIVATED=yes",
        command=command,
        env={"SUITE_VAR": "set"},
    )

    coverage, diagnosis = run(root, item)

    assert (root / "svc" / "seen.txt").read_text() == f"{(root / 'svc').resolve()}|set|yes"
    assert coverage == {"svc/app/m.py": {1: 1, 2: 1, 3: 0}}
    assert diagnosis is None
    log = (root / LOG).read_text()

    assert log.startswith(f"== api: {command}\n")
    assert "hello-from-suite" in log


def test_a_suite_in_a_directory_prefixes_its_lcov_paths(tmp_path):
    root = build(tmp_path, {"svc/app/m.py": BODY})

    coverage, diagnosis = run(
        root, raw(directory="svc", command=writes("out/lcov.info", LCOV_TEXT))
    )

    assert coverage == {"svc/app/m.py": {1: 1, 2: 1, 3: 0}}
    assert diagnosis is None


ROOT_REPORT = ".recognizer/cache/coverage/web/lcov.info"

NESTED_LCOV = "SF:src/a.py\nDA:1,1\nDA:2,0\nend_of_record\n"


def nested(name, command, path):
    return raw(
        name=name,
        directory=f"svc/{name}",
        command=command,
        coverage={"path": path, "format": "lcov"},
    )


def nested_repository(tmp_path):
    return build(tmp_path, {"svc/web/src/a.py": BODY, "svc/api/src/a.py": BODY})


def test_a_nested_suite_reads_a_report_under_the_root_cache(tmp_path):
    root = nested_repository(tmp_path)
    command = writes(f"../../{ROOT_REPORT}", NESTED_LCOV)

    coverage, diagnosis = run(root, nested("web", command, ROOT_REPORT))

    assert coverage == {"svc/web/src/a.py": {1: 1, 2: 0}}
    assert diagnosis is None
    assert sorted(path.name for path in (root / "svc" / "web").iterdir()) == ["src"]


def test_a_nested_suite_whose_command_writes_nothing_reports_the_root_path(tmp_path):
    root = nested_repository(tmp_path)

    coverage, diagnosis = run(root, nested("web", "true", ROOT_REPORT))

    assert coverage == {}
    assert diagnosis["code"] == "coverage-unavailable"
    assert f"left no coverage report at {ROOT_REPORT}" in diagnosis["line"]
    assert f"svc/web/{ROOT_REPORT}" not in diagnosis["line"]


def test_two_nested_suites_one_reporting_and_one_not_name_only_the_second(tmp_path):
    root = nested_repository(tmp_path)
    api_report = ".recognizer/cache/coverage/api/lcov.info"
    reporting = nested("web", writes(f"../../{ROOT_REPORT}", NESTED_LCOV), ROOT_REPORT)
    silent = nested("api", "true", api_report)

    coverage, diagnosis = run(root, reporting, silent)

    assert coverage == {"svc/web/src/a.py": {1: 1, 2: 0}}
    assert diagnosis["code"] == "coverage-unavailable"
    assert f"the api suite left no coverage report at {api_report}" in diagnosis["line"]
    assert "the web suite" not in diagnosis["line"]


def test_a_report_left_by_an_earlier_run_does_not_count_for_a_nested_suite(tmp_path):
    root = nested_repository(tmp_path)
    planted = root / ROOT_REPORT
    planted.parent.mkdir(parents=True)
    planted.write_text(NESTED_LCOV)

    coverage, diagnosis = run(root, nested("web", "true", ROOT_REPORT))

    assert coverage == {}
    assert diagnosis["code"] == "coverage-unavailable"


def test_suite_folder_matches_the_shared_slug_table():
    rows = json.loads((REPOSITORY / "fixtures" / "suites" / "folder-slugs.json").read_text())
    names = [row["name"] for row in rows]
    (parsed,) = parse_suites([raw(name="x")])

    assert names
    assert any(not all(c.isalnum() or c in "._-" for c in name) for name in names)
    assert any(name.startswith(".") for name in names)

    for row in rows:
        suite = replace(parsed, name=row["name"])

        assert suites_module.suite_folder(suite) == f".recognizer/cache/coverage/{row['slug']}"


def pin_clock(monkeypatch, moment):
    monkeypatch.setattr(suites_module, "time", SimpleNamespace(time=lambda: moment))


def seed(root, nanoseconds):
    report = root / "out" / "lcov.info"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(LCOV_TEXT)
    os.utime(report, ns=(nanoseconds, nanoseconds))

    return report


def test_a_report_modified_exactly_at_the_suite_start_is_read(tmp_path, monkeypatch):
    root = build(tmp_path)
    moment = 1_700_000_000
    pin_clock(monkeypatch, float(moment))
    seed(root, moment * 1_000_000_000)

    coverage, diagnosis = run(root, raw())

    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}}
    assert diagnosis is None


def test_a_report_a_nanosecond_older_than_the_suite_start_is_ignored_and_kept(
    tmp_path, monkeypatch
):
    root = build(tmp_path)
    moment = 1_700_000_000
    pin_clock(monkeypatch, float(moment))
    report = seed(root, moment * 1_000_000_000 - 1)

    coverage, diagnosis = run(root, raw())

    assert coverage == {}
    assert diagnosis["code"] == "coverage-unavailable"
    assert "the api suite left no coverage report at out/lcov.info" in diagnosis["line"]
    assert report.read_text() == LCOV_TEXT


def test_a_report_older_than_the_suite_start_is_ignored_and_kept(tmp_path):
    root = build(tmp_path)
    report = seed(root, int((time.time() - 3600) * 1e9))

    coverage, diagnosis = run(root, raw())

    assert coverage == {}
    assert diagnosis["code"] == "coverage-unavailable"
    assert report.read_text() == LCOV_TEXT


def test_two_suites_one_reporting_and_one_not_keep_the_first_and_name_the_second(tmp_path):
    root = build(
        tmp_path,
        {"app/m.py": BODY, "web/a.ts": "export function a(x: number) { return x; }\n"},
    )
    reporting = raw("python", name="py", command=writes("out/py.info"))
    reporting["coverage"]["path"] = "out/py.info"
    silent = raw("typescript", name="ts", command="true")

    coverage, diagnosis = run(root, reporting, silent)

    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}}
    assert diagnosis["code"] == "coverage-unavailable"
    assert "the ts suite left no coverage report at out/lcov.info" in diagnosis["line"]


def suite_events(capsys):
    prefix = "recognizer-event "

    return [
        json.loads(line[len(prefix) :])
        for line in capsys.readouterr().err.splitlines()
        if line.startswith(prefix) and '"note"' not in line
    ]


def test_two_suites_write_a_suites_start_and_progress_naming_each_suite(tmp_path, capsys):
    root = build(tmp_path)

    run(root, raw(name="one"), raw(name="two"))

    assert suite_events(capsys) == [
        {"event": "start", "total": 2, "unit": "suites"},
        {"event": "progress", "done": 0, "total": 2, "unit": "suites", "step": "one"},
        {"event": "progress", "done": 1, "total": 2, "unit": "suites", "step": "one"},
        {"event": "progress", "done": 1, "total": 2, "unit": "suites", "step": "two"},
        {"event": "progress", "done": 2, "total": 2, "unit": "suites", "step": "two"},
    ]


def test_one_suite_writes_no_start_or_progress(tmp_path, capsys):
    root = build(tmp_path)

    run(root, raw())

    assert suite_events(capsys) == []


def test_a_failing_suite_still_advances_the_suite_count(tmp_path, capsys):
    root = build(tmp_path)

    run(root, raw(name="one", command="exit 4"), raw(name="two"))

    done = [e["done"] for e in suite_events(capsys) if e["event"] == "progress"]

    assert done == [0, 1, 1, 2]


def test_a_suite_that_fails_after_writing_keeps_coverage_and_names_the_failures(tmp_path):
    root = build(tmp_path)
    command = f"{writes('out/lcov.info')}; echo 'FAILED tests/t.py::test_a - boom'; exit 1"

    coverage, diagnosis = run(root, raw(command=command))

    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}}
    assert diagnosis == {
        "code": "tests-failed",
        "line": "1 test failed, so coverage may read low",
        "failing": {"count": 1, "names": ["tests/t.py::test_a"]},
        "suite": "api",
    }


def test_a_suite_that_fails_and_writes_nothing_reports_the_exit(tmp_path):
    root = build(tmp_path)

    coverage, diagnosis = run(root, raw(command="exit 4"))

    assert coverage == {}
    assert diagnosis["line"] == (
        "coverage unavailable: the api suite exited 4 and left no coverage report at "
        f"out/lcov.info; see {LOG}"
    )


def test_a_scanned_language_with_no_suite_is_unknown_and_named(tmp_path):
    root = build(
        tmp_path,
        {"app/m.py": BODY, "web/a.ts": "export function a(x: number) { return x; }\n"},
    )

    coverage, diagnosis = run(root, raw("python", command=writes("out/lcov.info")))

    assert "web/a.ts" not in coverage
    assert diagnosis == {
        "code": "coverage-unavailable",
        "line": "coverage unavailable: no test suite is configured for typescript",
        "unmeasured": True,
    }


def test_a_suite_whose_language_is_not_scanned_is_skipped_and_runs_nothing(tmp_path):
    root = build(tmp_path)
    marker = root / "ran.txt"

    coverage, diagnosis = run(
        root,
        raw("python", name="py", command=writes("out/lcov.info")),
        raw("rust", name="rs", command=f"touch {shlex.quote(str(marker))}"),
    )

    assert not marker.exists()
    assert "== rs" not in (root / LOG).read_text()
    assert coverage == {"app/m.py": {1: 1, 2: 1, 3: 0}}
    assert diagnosis is None


def test_a_shell_that_cannot_start_is_a_tool_missing_refusal(tmp_path, monkeypatch):
    root = build(tmp_path)
    monkeypatch.setenv("SHELL", "/no/such/shell")

    with pytest.raises(Refusal) as refusal:
        run(root, raw())

    assert refusal.value.diagnosis == {
        "code": "tool-missing",
        "line": "/no/such/shell could not be started",
    }


def test_an_empty_report_is_named_by_suite(tmp_path):
    root = build(tmp_path)

    coverage, diagnosis = run(root, raw(command=writes("out/lcov.info", "")))

    assert coverage == {}
    assert "the api suite produced an empty coverage report" in diagnosis["line"]


def test_no_scan_runs_nothing(tmp_path):
    root = tmp_path / "bare"
    root.mkdir()

    assert collect_suites(root, [], parse_suites([raw()])) == ({}, None)
    assert not (root / LOG).exists()


def test_a_scan_with_no_files_still_reports_its_language_uncovered(tmp_path):
    root = tmp_path / "r"
    root.mkdir()
    scan = Scan("rust", (ScanModule("m", ()),), False)

    coverage, diagnosis = collect_suites(root, [scan], parse_suites([raw("python")]))

    assert coverage == {}
    assert diagnosis["line"] == "coverage unavailable: no test suite is configured for rust"


def test_crap_imports_none_of_the_inference_modules():
    program = (
        "import sys, recognizer_sensors.crap.sensor\n"
        "banned = ['projects', 'profiles', 'probes', 'preflight', 'run', 'selection', 'contexts']\n"
        "found = [n for n in banned if f'recognizer_sensors.testrun.{n}' in sys.modules]\n"
        "print(found)\n"
    )

    result = subprocess.run(
        [sys.executable, "-I", "-c", program],
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "PYTHONPATH": os.pathsep.join(sys.path)},
    )

    assert result.stdout.strip() == "[]"


def test_selected_keeps_config_order_whatever_order_the_names_come_in():
    suites = parse_suites([raw(name="unit"), raw(name="web"), raw(name="cli")])

    assert [s.name for s in selected(suites, ["cli", "unit"])] == ["unit", "cli"]
    assert selected(suites, None) == suites


def test_selected_rejects_an_unknown_name_and_an_empty_list():
    suites = parse_suites([raw(name="unit")])

    with pytest.raises(SettingsError, match="unknown test suite: nope"):
        selected(suites, ["unit", "nope"])

    with pytest.raises(SettingsError, match="at least one"):
        selected(suites, [])
