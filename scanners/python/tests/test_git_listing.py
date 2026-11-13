import json
import os
import stat
import subprocess
import sys
from pathlib import Path

from recognizer_scan_python.discovery import discover, git_listing

CONSOLE_SCRIPT = Path(sys.executable).parent / "recognizer-scan-python"
IGNORED = "out"
SOURCE = "src/a.py"
SIBLING = "src/b.py"
UNTRACKED = "src/new.py"


def run_git(folder, *args):
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=folder,
        check=True,
        capture_output=True,
        env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"},
    )


def write(folder, files):
    for relative, text in files.items():
        path = folder / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)


def make_repository(folder, tracked, extra=None, ignore=True):
    folder.mkdir(parents=True, exist_ok=True)
    run_git(folder, "init", "-q")
    write(folder, tracked)

    if ignore:
        (folder / ".gitignore").write_text(f"{IGNORED}/\n")

    run_git(folder, "add", "-f", *tracked, *([".gitignore"] if ignore else []))
    run_git(folder, "commit", "-q", "-m", "init")
    write(folder, extra or {})


def ids(folder):
    return discover(folder)


def test_an_ignored_copy_is_extracted_once_from_src(tmp_path):
    make_repository(
        tmp_path,
        {SOURCE: "x = 1\n"},
        {f"{IGNORED}/a.py": "x = 1\n"},
    )

    assert ids(tmp_path) == [SOURCE]


def test_an_untracked_file_git_does_not_ignore_is_extracted(tmp_path):
    make_repository(tmp_path, {SOURCE: "x = 1\n"}, {UNTRACKED: "x = 1\n"})

    assert ids(tmp_path) == [SOURCE, UNTRACKED]


def test_a_tracked_file_the_gitignore_names_is_extracted(tmp_path):
    make_repository(tmp_path, {SOURCE: "x = 1\n", f"{IGNORED}/kept.py": "x = 1\n"})

    assert ids(tmp_path) == [f"{IGNORED}/kept.py", SOURCE]


def test_a_tracked_file_deleted_from_disk_is_not_extracted(tmp_path):
    make_repository(tmp_path, {SOURCE: "x = 1\n", SIBLING: "x = 1\n"})
    (tmp_path / SIBLING).unlink()

    assert ids(tmp_path) == [SOURCE]


def test_a_folder_that_is_not_a_repository_extracts_the_ignored_copy_too(tmp_path):
    write(
        tmp_path, {SOURCE: "x = 1\n", f"{IGNORED}/a.py": "x = 1\n", ".gitignore": f"{IGNORED}/\n"}
    )

    assert ids(tmp_path) == [f"{IGNORED}/a.py", SOURCE]


def test_a_mixed_tree_extracts_the_tracked_and_the_untracked_not_ignored(tmp_path):
    make_repository(
        tmp_path,
        {SOURCE: "x = 1\n", SIBLING: "x = 1\n"},
        {UNTRACKED: "x = 1\n", f"{IGNORED}/c.py": "x = 1\n"},
    )
    (tmp_path / SIBLING).unlink()

    assert ids(tmp_path) == [SOURCE, UNTRACKED]


def test_a_missing_git_scans_every_file_without_a_warning(tmp_path, monkeypatch, capsys):
    make_repository(tmp_path, {SOURCE: "x = 1\n"}, {f"{IGNORED}/a.py": "x = 1\n"})
    empty = tmp_path.parent / (tmp_path.name + "-empty")
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))

    assert git_listing(tmp_path) is None
    assert ids(tmp_path) == [f"{IGNORED}/a.py", SOURCE]
    assert capsys.readouterr().err == ""


def test_a_git_refusal_scans_every_file_and_warns_once(tmp_path, monkeypatch, capsys):
    make_repository(tmp_path, {SOURCE: "x = 1\n"}, {f"{IGNORED}/a.py": "x = 1\n"})
    wrapper = tmp_path.parent / (tmp_path.name + "-wrapper")
    wrapper.mkdir()
    script = wrapper / "git"
    script.write_text(
        "#!/bin/sh\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", str(wrapper))

    assert ids(tmp_path) == [f"{IGNORED}/a.py", SOURCE]
    assert capsys.readouterr().err == (
        "recognizer-scan-python: git could not list files "
        "(fatal: detected dubious ownership in repository); scanning every file\n"
    )


def test_a_nested_repository_is_not_extracted(tmp_path):
    make_repository(tmp_path, {SOURCE: "x = 1\n"})
    make_repository(tmp_path / "inner", {"src/x.py": "x = 1\n"}, ignore=False)

    assert ids(tmp_path) == [SOURCE]


def test_a_subfolder_root_extracts_its_own_src_with_ids_relative_to_it(tmp_path):
    make_repository(
        tmp_path,
        {f"sub/{SOURCE}": "x = 1\n"},
        {f"sub/{IGNORED}/a.py": "x = 1\n"},
        ignore=False,
    )
    (tmp_path / ".gitignore").write_text(f"sub/{IGNORED}/\n")

    assert ids(tmp_path / "sub") == [SOURCE]


def test_test_files_and_manifests_in_an_ignored_folder_are_not_read(tmp_path):
    from recognizer_scan_python.discovery import discover_tests
    from recognizer_scan_python.script_entry_points import find_manifests

    make_repository(
        tmp_path,
        {SOURCE: "x = 1\n", "tests/test_a.py": "", "pyproject.toml": ""},
        {f"{IGNORED}/tests/test_b.py": "", f"{IGNORED}/pyproject.toml": ""},
    )

    assert discover_tests(tmp_path) == ["tests/test_a.py"]
    assert find_manifests(tmp_path) == ["pyproject.toml"]


def test_a_scan_reports_each_module_once(tmp_path):
    from recognizer_scan_python import scan

    make_repository(tmp_path, {SOURCE: "x = 1\n"}, {f"{IGNORED}/a.py": "x = 1\n"})

    document = scan(tmp_path, ["."], None)

    assert [m["id"] for m in document["modules"]] == [SOURCE]


def test_the_repository_scan_equals_the_walk_filtered_by_git_ls_files():
    from conftest import REPOSITORY

    listed = set(
        subprocess.run(
            [
                "git",
                "-C",
                str(REPOSITORY),
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split("\0")
    )
    walked = discover(REPOSITORY, None)
    filtered = [path for path in walked if path in listed]

    assert discover(REPOSITORY) == filtered
    assert filtered
    assert not any(
        path.startswith(("node_modules/", "dist/", ".recognizer/cache/"))
        for path in discover(REPOSITORY)
    )


def test_the_cli_extracts_the_tracked_and_untracked_modules_and_not_the_ignored_copy(tmp_path):
    make_repository(
        tmp_path,
        {SOURCE: "x = 1\n"},
        {UNTRACKED: "x = 1\n", f"{IGNORED}/a.py": "x = 1\n", f"{IGNORED}/new.py": "x = 1\n"},
    )

    result = subprocess.run(
        [str(CONSOLE_SCRIPT), "run", str(tmp_path)], capture_output=True, text=True, check=True
    )

    assert sorted(m["id"] for m in json.loads(result.stdout)["modules"]) == [SOURCE, UNTRACKED]
