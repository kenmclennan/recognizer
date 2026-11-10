import os
import stat
import subprocess

from recognizer_scan_csharp.discovery import discover, git_listing

IGNORED = "out"
SOURCE = "src/a.cs"
SIBLING = "src/b.cs"
UNTRACKED = "src/new.cs"


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
    return discover(folder).sources


def test_an_ignored_copy_is_extracted_once_from_src(tmp_path):
    make_repository(
        tmp_path,
        {SOURCE: "class A {}\n"},
        {f"{IGNORED}/a.cs": "class A {}\n"},
    )

    assert ids(tmp_path) == [SOURCE]


def test_an_untracked_file_git_does_not_ignore_is_extracted(tmp_path):
    make_repository(tmp_path, {SOURCE: "class A {}\n"}, {UNTRACKED: "class A {}\n"})

    assert ids(tmp_path) == [SOURCE, UNTRACKED]


def test_a_tracked_file_the_gitignore_names_is_extracted(tmp_path):
    make_repository(tmp_path, {SOURCE: "class A {}\n", f"{IGNORED}/kept.cs": "class A {}\n"})

    assert ids(tmp_path) == [f"{IGNORED}/kept.cs", SOURCE]


def test_a_tracked_file_deleted_from_disk_is_not_extracted(tmp_path):
    make_repository(tmp_path, {SOURCE: "class A {}\n", SIBLING: "class A {}\n"})
    (tmp_path / SIBLING).unlink()

    assert ids(tmp_path) == [SOURCE]


def test_a_folder_that_is_not_a_repository_extracts_the_ignored_copy_too(tmp_path):
    write(
        tmp_path,
        {SOURCE: "class A {}\n", f"{IGNORED}/a.cs": "class A {}\n", ".gitignore": f"{IGNORED}/\n"},
    )

    assert ids(tmp_path) == [f"{IGNORED}/a.cs", SOURCE]


def test_a_mixed_tree_extracts_the_tracked_and_the_untracked_not_ignored(tmp_path):
    make_repository(
        tmp_path,
        {SOURCE: "class A {}\n", SIBLING: "class A {}\n"},
        {UNTRACKED: "class A {}\n", f"{IGNORED}/c.cs": "class A {}\n"},
    )
    (tmp_path / SIBLING).unlink()

    assert ids(tmp_path) == [SOURCE, UNTRACKED]


def test_a_missing_git_scans_every_file_without_a_warning(tmp_path, monkeypatch, capsys):
    make_repository(tmp_path, {SOURCE: "class A {}\n"}, {f"{IGNORED}/a.cs": "class A {}\n"})
    empty = tmp_path.parent / (tmp_path.name + "-empty")
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))

    assert git_listing(tmp_path) is None
    assert ids(tmp_path) == [f"{IGNORED}/a.cs", SOURCE]
    assert capsys.readouterr().err == ""


def test_a_git_refusal_scans_every_file_and_warns_once(tmp_path, monkeypatch, capsys):
    make_repository(tmp_path, {SOURCE: "class A {}\n"}, {f"{IGNORED}/a.cs": "class A {}\n"})
    wrapper = tmp_path.parent / (tmp_path.name + "-wrapper")
    wrapper.mkdir()
    script = wrapper / "git"
    script.write_text(
        "#!/bin/sh\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", str(wrapper))

    assert ids(tmp_path) == [f"{IGNORED}/a.cs", SOURCE]
    assert capsys.readouterr().err == (
        "recognizer-scan-csharp: git could not list files "
        "(fatal: detected dubious ownership in repository); scanning every file\n"
    )


def test_a_nested_repository_is_not_extracted(tmp_path):
    make_repository(tmp_path, {SOURCE: "class A {}\n"})
    make_repository(tmp_path / "inner", {"src/x.cs": "class A {}\n"}, ignore=False)

    assert ids(tmp_path) == [SOURCE]


def test_a_subfolder_root_extracts_its_own_src_with_ids_relative_to_it(tmp_path):
    make_repository(
        tmp_path,
        {f"sub/{SOURCE}": "class A {}\n"},
        {f"sub/{IGNORED}/a.cs": "class A {}\n"},
        ignore=False,
    )
    (tmp_path / ".gitignore").write_text(f"sub/{IGNORED}/\n")

    assert ids(tmp_path / "sub") == [SOURCE]
