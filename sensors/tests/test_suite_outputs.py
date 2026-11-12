import json
import re
import shlex
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

import pytest
from conftest import REPOSITORY, git_commit, make_repository, mutate_repository, shim_suite
from test_mutation import run_mutate

from recognizer_sensors.scans import read_scans
from recognizer_sensors.testrun.readiness import check
from recognizer_sensors.testrun.suites import (
    collect_suites,
    parse_suites,
    prepare_suite_folder,
    suite_environment,
    suite_folder,
)

GUIDE = REPOSITORY / "fixtures" / "config-edit" / "guide"

BODY = "def f(a):\n    if a:\n        return 1\n    return 2\n"

LCOV_TEXT = "SF:app/m.py\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n"

CACHE = ".recognizer/cache/coverage"

JACOCO = (
    '<report name="r"><package name="app"><sourcefile name="Main.kt">'
    '<line nr="1" mi="0" ci="1"/><line nr="2" mi="1" ci="0"/></sourcefile></package></report>'
)

GUIDE_IGNORES = (
    "target/\nbuild/\n.gradle/\n.kotlin/\nbin/\nobj/\nTestResults/\nnode_modules/\n.pytest_cache/\n"
)

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.com",
    "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
}


@pytest.fixture(autouse=True)
def plain_shell(monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")


def status(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(root), "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
        env=GIT_ENV,
    )

    return sorted(line for line in result.stdout.splitlines() if line)


def suite(**overrides):
    base = {
        "name": "api",
        "language": "python",
        "directory": ".",
        "command": "true",
        "coverage": {"path": f"{CACHE}/api/lcov.info", "format": "lcov"},
    }

    return {**base, **overrides}


def committed(tmp_path, files, ignores=".recognizer/cache/\n"):
    root = make_repository(tmp_path / "r", {".gitignore": ignores, **files})
    git_commit(root)

    return root


def test_a_python_suite_gets_both_variables_as_absolute_paths_in_the_cache(tmp_path):
    (python,) = parse_suites([suite()])
    environment = suite_environment(tmp_path, python)
    root = tmp_path.resolve() / ".recognizer" / "cache"

    assert environment == {
        "COVERAGE_FILE": str(root / "coverage" / "api" / "data"),
        "PYTHONPYCACHEPREFIX": str(root / "pycache"),
    }


@pytest.mark.parametrize("language", ["typescript", "kotlin", "rust", "csharp"])
def test_a_suite_of_another_language_gets_no_variables(tmp_path, language):
    extra = {"runner": "vitest"} if language == "typescript" else {}
    (other,) = parse_suites([suite(language=language, **extra)])

    assert suite_environment(tmp_path, other) == {}


def test_a_suite_env_value_wins_and_the_other_variable_is_still_set(tmp_path):
    (python,) = parse_suites([suite(env={"COVERAGE_FILE": "mine"})])

    assert list(suite_environment(tmp_path, python)) == ["PYTHONPYCACHEPREFIX"]


@pytest.mark.parametrize(
    ("name", "folder"), [("a b", "a-b"), ("../x", "-.-x"), ("api", "api"), (".hidden", "-hidden")]
)
def test_a_suite_name_cannot_leave_the_coverage_folder(name, folder):
    (parsed,) = parse_suites([suite(name=name)])

    assert suite_folder(parsed) == f"{CACHE}/{folder}"


def test_prepare_suite_folder_empties_only_that_suites_folder(tmp_path):
    (parsed,) = parse_suites([suite()])
    (tmp_path / CACHE / "api").mkdir(parents=True)
    (tmp_path / CACHE / "api" / "old").write_text("x")
    (tmp_path / CACHE / "web").mkdir(parents=True)
    (tmp_path / CACHE / "web" / "keep").write_text("x")

    prepare_suite_folder(tmp_path, parsed)

    assert list((tmp_path / CACHE / "api").iterdir()) == []
    assert (tmp_path / CACHE / "web" / "keep").exists()


def test_a_stale_report_is_not_read_when_the_suite_writes_none(tmp_path):
    root = committed(tmp_path, {"app/m.py": BODY})
    stale = root / CACHE / "api"
    stale.mkdir(parents=True)
    (stale / "lcov.info").write_text(LCOV_TEXT)
    results: dict = {}

    coverage, diagnosis = collect_suites(
        root, read_scans(root), parse_suites([suite()]), results=results
    )

    assert coverage == {}
    assert "left no coverage report at" in diagnosis["line"]
    assert results["api"]["status"] == "failed"


def python_fixture(tmp_path):
    return committed(
        tmp_path,
        {
            "pkg/__init__.py": "",
            "pkg/m.py": BODY,
            "tests/test_m.py": "from pkg.m import f\n\n\ndef test_f():\n    assert f(1) == 1\n",
        },
        ignores=".recognizer/cache/\n",
    )


def real_pytest_suite():
    command = (
        f"{shlex.quote(sys.executable)} -m pytest -q --cov=pkg "
        f"--cov-report=lcov:{CACHE}/api/lcov.info"
    )

    return suite(command=command)


def test_real_pytest_under_collect_suites_leaves_the_tree_as_it_found_it(tmp_path):
    root = python_fixture(tmp_path)

    coverage, _ = collect_suites(root, read_scans(root), parse_suites([real_pytest_suite()]))

    assert (root / CACHE / "api" / "lcov.info").is_file()
    assert coverage
    assert status(root) == []


def test_real_pytest_under_check_run_leaves_the_tree_as_it_found_it(tmp_path):
    root = python_fixture(tmp_path)
    settings = {"suites": [asdict(parse_suites([real_pytest_suite()])[0])]}

    assert check(root, settings, True) == []
    assert (root / CACHE / "api" / "lcov.info").is_file()
    assert status(root) == []


def guide_suite(name: str) -> dict:
    text = (GUIDE / f"{name}.yaml").read_text()
    entry = text.split("tests:\n", 1)[1]

    def field(key: str) -> str:
        found = re.search(rf"^\s+(?:- )?{key}: (.+)$", entry, re.M)

        return found.group(1).strip().strip("'\"") if found else ""

    parsed = {
        "name": field("name"),
        "language": field("language"),
        "directory": field("directory"),
        "command": "true",
        "coverage": {"path": field("path"), "format": field("format")},
    }

    if field("runner"):
        parsed["runner"] = field("runner")

    return parsed


EXTENSION = {"python": "py", "typescript": "ts", "kotlin": "kt", "rust": "rs", "csharp": "cs"}

TOOL_FILES = {
    "python": [".pytest_cache/.gitignore"],
    "typescript": [],
    "rust": ["target/debug/out"],
    "kotlin": ["build/classes/x", ".gradle/x", ".kotlin/x"],
    "csharp": ["bin/x", "obj/x", "tests/TestResults/run/results_x.trx"],
}

UNREDIRECTED = {
    "python": [],
    "typescript-vitest": [],
    "typescript-jest": [],
    "typescript-package": ["packages/web/coverage/"],
    "rust": ["target/"],
    "rust-workspace": ["target/"],
    "rust-crate": ["crates/ignore/lcov.info"],
    "kotlin": ["build/", ".gradle/", ".kotlin/"],
    "kotlin-workspace": ["build/", ".gradle/", ".kotlin/"],
    "csharp": ["bin/", "obj/", "tests/TestResults/"],
}


def source_for(entry: dict) -> str:
    directory = entry["directory"]
    base = "" if directory == "." else f"{directory}/"
    extension = EXTENSION[entry["language"]]

    return (
        f"{base}app/Main.{extension}"
        if entry["language"] == "kotlin"
        else f"{base}app/m.{extension}"
    )


def writer(entry: dict) -> str:
    language = entry["language"]
    directory = entry["directory"]
    report = entry["coverage"]["path"].replace("**/", "")
    lines = []

    if language == "python":
        lines += [
            'mkdir -p "$(dirname "${COVERAGE_FILE:-.coverage}")" && : > "${COVERAGE_FILE:-.coverage}"',
            'p="${PYTHONPYCACHEPREFIX:-__pycache__}"; mkdir -p "$p" && : > "$p/x.pyc"',
            "mkdir -p .pytest_cache && printf '*' > .pytest_cache/.gitignore",
        ]
    else:
        for tool in TOOL_FILES[language]:
            if tool.startswith("target/debug") and directory != ".":
                continue

            lines.append(
                f"mkdir -p {shlex.quote(str(Path(tool).parent))} && : > {shlex.quote(tool)}"
            )

    path = report.replace("*", "run")
    text = JACOCO if entry["coverage"]["format"] == "jacoco" else None

    if text is None:
        text = f"SF:app/m.{EXTENSION[language]}\nDA:1,1\nDA:2,0\nend_of_record\n"

    lines.append(f"mkdir -p {shlex.quote(str(Path(path).parent))}")
    lines.append(f"printf %s {shlex.quote(text)} > {shlex.quote(path)}")

    return "; ".join(lines)


def guide_repository(tmp_path, name: str, ignores: str):
    entry = guide_suite(name)
    directory = entry["directory"]
    base = "" if directory == "." else f"{directory}/"
    source = source_for(entry)
    files = {
        source: "x\n",
        f"{base}.keep": "",
        "tests/.keep": "",
        ".gitignore": ".recognizer/cache/\n" + ignores,
    }
    root = tmp_path / "r"

    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)

    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    scan = {
        "files": [{"path": source, "hash": "0" * 64}],
        "modules": [{"id": source}],
        "modified": False,
    }
    (cache / f"scan.{entry['language']}.json").write_text(json.dumps(scan))
    git_commit(root)

    return root, {**entry, "command": writer(entry)}


@pytest.mark.parametrize("name", sorted(UNREDIRECTED))
def test_a_guide_suite_leaves_only_the_paths_the_guide_lists_as_not_redirectable(tmp_path, name):
    root, entry = guide_repository(tmp_path, name, "")

    coverage, _ = collect_suites(root, read_scans(root), parse_suites([entry]))

    assert coverage
    assert [line[3:] for line in status(root)] == sorted(UNREDIRECTED[name])


@pytest.mark.parametrize("name", sorted(UNREDIRECTED))
def test_a_guide_suite_with_the_guide_ignores_leaves_the_tree_clean(tmp_path, name):
    ignores = GUIDE_IGNORES
    entry = guide_suite(name)

    if entry["directory"] != ".":
        ignores += f"{entry['directory']}/{entry['coverage']['path'].split('/')[0]}/\n"
        ignores += f"{entry['directory']}/{entry['coverage']['path']}\n"

    root, entry = guide_repository(tmp_path, name, ignores)

    coverage, _ = collect_suites(root, read_scans(root), parse_suites([entry]))

    assert coverage
    assert status(root) == []


def test_a_mutation_warmup_leaves_the_tree_as_it_found_it(tmp_path):
    root, commit = mutate_repository(tmp_path)
    (root / ".gitignore").write_text(".recognizer/cache/\n")
    subprocess.run(["git", "-C", str(root), "add", ".gitignore"], check=True, env=GIT_ENV)
    subprocess.run(
        ["git", "-C", str(root), "commit", "-q", "-m", "ignore"], check=True, env=GIT_ENV
    )
    body = f"{shlex.quote(sys.executable)} -c pass"
    settings = {"tests": [shim_suite(body)], "max_workers": 1}

    assert (
        run_mutate(root, tmp_path / "overlay.json", json.dumps(settings), "--commit", commit) == 0
    )
    assert status(root) == []


def test_a_warmup_copy_kept_from_an_earlier_run_loses_its_old_report(tmp_path):
    from recognizer_sensors.mutation.warmup import run_suite_in

    root = committed(tmp_path, {"app/m.py": BODY})
    copy = tmp_path / "copy"
    old = copy / CACHE / "api"
    old.mkdir(parents=True)
    (old / "lcov.info").write_text(LCOV_TEXT)
    (parsed,) = parse_suites([suite()])

    run_suite_in(root, copy, parsed, "true", {})

    assert not (old / "lcov.info").exists()
