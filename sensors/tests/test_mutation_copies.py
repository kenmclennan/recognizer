import os
import shutil
import sys
import threading

import pytest
from conftest import git_commit, make_repository

from recognizer_sensors.mutation import runner
from recognizer_sensors.mutation.runner import (
    Mutant,
    MutantCopies,
    ResetFailed,
    copy_repository,
    new_work_folder,
    remove_stale_work_folders,
    remove_work_folder,
)
from recognizer_sensors.testrun.suites import Suite

SUITE = Suite("t", "python", ".", "true", None, {}, "cov.info", "lcov", None)

PYPROJECT = '[project]\nname = "t"\nversion = "0"\nrequires-python = ">=3.11"\n'

MODULE = "def f(a):\n    if a:\n        return 1\n    return 2\n\n\ndef g(a):\n    return a\n"

TESTS = "from m import f, g\n\n\ndef test_f():\n    assert f(1) == 1\n\n\ndef test_g():\n    assert g(a=2) == 2\n"

PLAIN = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"]


def run_mutant(project, work, number, item, command, timeout, copies=None, carry=()):
    return runner.run_mutant(
        project, work, number, item, command, timeout, SUITE, carry=carry, copies=copies
    )


def mutant(old: str, new: str, source: str = MODULE) -> Mutant:
    data = source.encode()
    start = data.index(old.encode())

    return Mutant("m.py", data, start, start + len(old), new.encode())


KILLING = mutant("return 1", "return 3")
SURVIVING = mutant("return 2", "return 3")


@pytest.fixture
def project(tmp_path):
    root = make_repository(
        tmp_path / "p", {"pyproject.toml": PYPROJECT, "m.py": MODULE, "test_m.py": TESTS}
    )
    git_commit(root)

    return root


@pytest.fixture
def work(project):
    folder = new_work_folder(project)

    yield folder

    remove_work_folder(folder)


def verdicts(project, work, order, command, copies):
    return [
        run_mutant(project, work, 0, item, command, 120.0, copies=copies).verdict for item in order
    ]


def expected(order):
    return ["killed" if item is KILLING else "survived" for item in order]


@pytest.mark.parametrize("order", [(KILLING, SURVIVING), (SURVIVING, KILLING)])
def test_a_verdict_never_depends_on_the_mutant_before_it_in_a_pooled_copy(project, work, order):
    copies = MutantCopies(project, work, 1)

    assert verdicts(project, work, order, PLAIN, copies) == expected(order)


def test_a_same_size_mutant_straight_after_another_is_not_hidden_by_stale_bytecode(tmp_path):
    source = "def h(a):\n    return a + 1\n\n\ndef k(a):\n    return a + 0\n"
    tests = "from m import h, k\n\n\ndef test_h():\n    assert h(1) == 2\n\n\ndef test_k():\n    assert k(1) == 1\n"
    root = make_repository(tmp_path / "b", {"m.py": source, "test_m.py": tests})
    git_commit(root)
    folder = new_work_folder(root)
    killing = mutant("+ 1", "- 1", source)
    surviving = mutant("+ 0", "- 0", source)
    copies = MutantCopies(root, folder, 1)

    try:
        assert len(killing.replacement) == len(surviving.replacement)
        assert verdicts(root, folder, [killing, surviving, killing, surviving], PLAIN, copies) == [
            "killed",
            "survived",
            "killed",
            "survived",
        ]
    finally:
        remove_work_folder(folder)


def test_reset_restores_tracked_files_and_removes_what_the_run_wrote(project, work):
    (project / "keep.txt").write_text("keep")
    (project / "snap.txt").write_text("original")
    git_commit(project)

    copies = MutantCopies(project, work, 1)
    rewrite = [
        sys.executable,
        "-c",
        "import os; open('snap.txt','w').write('changed!!'); open('stray','w').write('x');"
        "os.makedirs('out/deep'); open('out/deep/log','w').write('x')",
    ]

    run_mutant(project, work, 0, SURVIVING, rewrite, 60.0, copies=copies)

    with copies.lease() as slot:
        copy = slot.prepare()

        assert (copy.path / "snap.txt").read_text() == "original"
        assert (copy.path / "m.py").read_text() == MODULE
        assert (copy.path / "keep.txt").read_text() == "keep"
        assert not (copy.path / "stray").exists()
        assert not (copy.path / "out").exists()


def test_reset_leaves_an_untouched_file_alone(project, work):
    copies = MutantCopies(project, work, 1)

    with copies.lease() as slot:
        copy = slot.prepare()
        before = os.lstat(copy.path / "test_m.py").st_ino

    with copies.lease() as slot:
        copy = slot.prepare()

        assert os.lstat(copy.path / "test_m.py").st_ino == before


def test_build_output_beside_a_manifest_survives_and_other_new_paths_do_not(tmp_path, work):
    root = make_repository(tmp_path / "r", {"m.py": MODULE, "test_m.py": TESTS})
    git_commit(root)
    folder = new_work_folder(root)
    copies = MutantCopies(root, folder, 1, ("build",))
    script = [
        sys.executable,
        "-c",
        "import os; os.makedirs('build/debug'); open('build/debug/a','w').write('x');"
        "os.makedirs('elsewhere'); open('elsewhere/b','w').write('x')",
    ]

    try:
        run_mutant(root, folder, 0, SURVIVING, script, 60.0, copies=copies, carry=("build",))

        with copies.lease() as slot:
            copy = slot.prepare()

            assert (copy.path / "build" / "debug" / "a").read_text() == "x"
            assert not (copy.path / "elsewhere").exists()
    finally:
        remove_work_folder(folder)


def carry_repository(tmp_path):
    root = make_repository(
        tmp_path / "c",
        {
            "m.py": MODULE,
            ".gitignore": "node_modules/\ntarget/\n",
            "node_modules/dep/index.js": "x",
            "frontend/node_modules/dep/index.js": "y",
            "target/debug/a": "z",
        },
    )
    (root / ".gitignore").write_text("node_modules/\ntarget/\n")
    git_commit(root)

    return root


def test_a_repository_with_no_carry_copies_exactly_its_git_listed_files(tmp_path):
    root = carry_repository(tmp_path)
    copy = tmp_path / "copy"

    copy_repository(root, copy)

    assert not (copy / "node_modules").exists()
    assert not (copy / "frontend" / "node_modules").exists()
    assert not (copy / "target").exists()
    assert (copy / "m.py").is_file()


def test_a_carry_entry_names_the_exact_folder_and_nothing_at_other_depths(tmp_path):
    root = carry_repository(tmp_path)
    copy = tmp_path / "copy"

    copy_repository(root, copy, ("frontend/node_modules",))

    assert (copy / "frontend" / "node_modules" / "dep" / "index.js").is_file()
    assert not (copy / "node_modules").exists()
    assert not (copy / "target").exists()


def test_a_carried_folder_is_in_the_copy_and_a_reset_leaves_it_untouched(tmp_path):
    root = carry_repository(tmp_path)
    folder = new_work_folder(root)
    copies = MutantCopies(root, folder, 1, ("node_modules",))

    try:
        with copies.lease() as slot:
            copy = slot.prepare()
            marker = copy.path / "node_modules" / "dep" / "index.js"
            marker.write_text("edited by a run")

        with copies.lease() as slot:
            copy = slot.prepare()

            assert (
                copy.path / "node_modules" / "dep" / "index.js"
            ).read_text() == "edited by a run"
            assert not (copy.path / "target").exists()
    finally:
        remove_work_folder(folder)


def test_a_timed_out_run_retires_the_copy(project, work):
    copies = MutantCopies(project, work, 1)
    slow = [sys.executable, "-c", "import time; time.sleep(30)"]

    assert run_mutant(project, work, 0, SURVIVING, slow, 0.5, copies=copies).verdict == "timeout"
    assert copies.slots[0].copy is None
    assert not (work / "mutant-0").exists()
    assert verdicts(project, work, [KILLING], PLAIN, copies) == ["killed"]


def test_a_command_that_cannot_start_retires_the_copy(project, work, monkeypatch):
    copies = MutantCopies(project, work, 1)

    monkeypatch.setenv("SHELL", "/nonexistent/shell")
    run_mutant(project, work, 0, SURVIVING, ["tool"], 5.0, copies=copies)
    monkeypatch.setenv("SHELL", "/bin/sh")

    assert copies.slots[0].copy is None
    assert verdicts(project, work, [SURVIVING], PLAIN, copies) == ["survived"]


def test_a_stop_while_leased_retires_the_copy(project, work, monkeypatch):
    copies = MutantCopies(project, work, 1)

    def stopping(command, cwd, timeout, suite=None, extra=None):
        runner.STOP.set()

        return runner.TestRun(0, False, 0.0, "")

    monkeypatch.setattr(runner, "run_test_command", stopping)

    try:
        run_mutant(project, work, 0, SURVIVING, PLAIN, 5.0, copies=copies)
    finally:
        runner.STOP.clear()

    assert copies.slots[0].copy is None


def test_a_failed_reset_makes_a_fresh_copy_and_never_yields_a_verdict_from_the_old_one(
    project, work, monkeypatch
):
    copies = MutantCopies(project, work, 1)

    assert verdicts(project, work, [SURVIVING], PLAIN, copies) == ["survived"]

    first = copies.slots[0].copy
    real = runner.PooledCopy.reset
    seen = []

    def failing(self):
        seen.append(self)
        raise ResetFailed("m.py")

    monkeypatch.setattr(runner.PooledCopy, "reset", failing)

    assert verdicts(project, work, [KILLING], PLAIN, copies) == ["killed"]
    assert seen == [first]
    assert copies.slots[0].copy is not first

    monkeypatch.setattr(runner.PooledCopy, "reset", real)

    assert verdicts(project, work, [SURVIVING], PLAIN, copies) == ["survived"]


def test_an_oserror_in_reset_retires_the_copy(project, work, monkeypatch):
    copies = MutantCopies(project, work, 1)

    verdicts(project, work, [SURVIVING], PLAIN, copies)

    first = copies.slots[0].copy

    def broken(self):
        raise OSError("gone")

    monkeypatch.setattr(runner.PooledCopy, "reset", broken)

    assert verdicts(project, work, [KILLING], PLAIN, copies) == ["killed"]
    assert copies.slots[0].copy is not first


def test_a_reset_that_cannot_match_the_manifest_raises(project, work):
    copies = MutantCopies(project, work, 1)

    with copies.lease() as slot:
        copy = slot.prepare()

        copy.manifest["m.py"] = (0, 0, 0)

        original = runner.PooledCopy.restore

        def keep(self, relative):
            original(self, relative)
            self.manifest[relative] = (0, 0, 0)

        runner.PooledCopy.restore = keep

        try:
            with pytest.raises(ResetFailed):
                copy.reset()
        finally:
            runner.PooledCopy.restore = original


def test_pooling_is_off_when_git_cannot_list_files_and_verdicts_match(tmp_path):
    plain = make_repository(tmp_path / "plain", {"m.py": MODULE, "test_m.py": TESTS})
    folder = new_work_folder(plain)

    try:
        copies = MutantCopies(plain, folder, 1)

        assert copies.enabled is False

        order = [KILLING, SURVIVING]

        assert verdicts(plain, folder, order, PLAIN, None) == expected(order)
    finally:
        remove_work_folder(folder)


def test_a_pool_over_a_git_repository_is_enabled(project, work):
    assert MutantCopies(project, work, 2).enabled is True


def test_pooled_copies_live_in_the_work_folder_and_are_cleaned_with_it(project, work):
    copies = MutantCopies(project, work, 2)
    done = threading.Barrier(2)

    def go(item):
        run_mutant(project, work, 0, item, PLAIN, 120.0, copies=copies)
        done.wait(timeout=60)

    threads = [threading.Thread(target=go, args=(item,)) for item in (KILLING, SURVIVING)]

    for thread in threads:
        thread.start()

    for thread in threads:
        thread.join()

    assert {path.name for path in work.glob("mutant-*")} == {"mutant-0", "mutant-1"}

    remove_work_folder(work)

    assert not work.exists()


def test_a_dead_pid_work_folder_with_pooled_copies_is_swept_and_a_live_one_kept(project, work):
    stale = project / runner.WORK / "999999999-dead"
    (stale / "mutant-0").mkdir(parents=True)
    (stale / runner.PID_FILE).write_text("999999999")

    live = project / runner.WORK / f"{os.getpid()}-live"
    (live / "mutant-0").mkdir(parents=True)
    (live / runner.PID_FILE).write_text(str(os.getpid()))

    remove_stale_work_folders(work)

    assert not stale.exists()
    assert (live / "mutant-0").exists()

    shutil.rmtree(live)


def test_the_stop_handler_leave_removes_pooled_copies(project, work):
    copies = MutantCopies(project, work, 1)
    run_mutant(project, work, 0, SURVIVING, PLAIN, 120.0, copies=copies)

    assert (work / "mutant-0").exists()

    restore = runner.install_stop_handler(work)

    try:
        runner.remove_work_folder(work)
    finally:
        restore()

    assert not (work / "mutant-0").exists()
