import os
import shutil
import subprocess
import sys
import threading

import pytest
from conftest import git_commit, make_repository

from recognizer_sensors.mutation import runner
from recognizer_sensors.mutation.runner import (
    EnvironmentPool,
    Mutant,
    MutantCopies,
    ResetFailed,
    new_work_folder,
    remove_stale_work_folders,
    remove_work_folder,
    run_mutant,
)

PYPROJECT = '[project]\nname = "t"\nversion = "0"\nrequires-python = ">=3.11"\n'

MODULE = "def f(a):\n    if a:\n        return 1\n    return 2\n\n\ndef g(a):\n    return a\n"

TESTS = "from m import f, g\n\n\ndef test_f():\n    assert f(1) == 1\n\n\ndef test_g():\n    assert g(a=2) == 2\n"

PLAIN = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"]

UV = ["uv", "run", "pytest", "-q", "-p", "no:cacheprovider"]

needs_uv = pytest.mark.skipif(shutil.which("uv") is None, reason="needs uv on PATH")


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


def verdicts(project, work, order, command, copies, environments=None):
    return [
        run_mutant(
            project, work, 0, item, command, 120.0, copies=copies, environments=environments
        ).verdict
        for item in order
    ]


def expected(order):
    return ["killed" if item is KILLING else "survived" for item in order]


@pytest.mark.parametrize("order", [(KILLING, SURVIVING), (SURVIVING, KILLING)])
def test_a_verdict_never_depends_on_the_mutant_before_it_in_a_pooled_copy(project, work, order):
    copies = MutantCopies(project, work, 1)

    assert verdicts(project, work, order, PLAIN, copies) == expected(order)


@needs_uv
@pytest.mark.parametrize("order", [(KILLING, SURVIVING), (SURVIVING, KILLING)])
def test_a_verdict_never_depends_on_the_mutant_before_it_in_a_pooled_uv_copy(project, work, order):
    subprocess.run(["uv", "lock", "-q"], cwd=project, check=True, capture_output=True)
    git_commit(project)

    copies = MutantCopies(project, work, 1)
    pool = EnvironmentPool(project, work, 1)

    try:
        assert verdicts(project, work, order, UV, copies, pool) == expected(order)
    finally:
        remove_work_folder(pool.folder)


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
    root = make_repository(
        tmp_path / "r",
        {"Cargo.toml": "[package]\n", "m.py": MODULE, "test_m.py": TESTS},
    )
    git_commit(root)
    folder = new_work_folder(root)
    copies = MutantCopies(root, folder, 1)
    script = [
        sys.executable,
        "-c",
        "import os; os.makedirs('target/debug'); open('target/debug/a','w').write('x');"
        "os.makedirs('elsewhere'); open('elsewhere/b','w').write('x')",
    ]

    try:
        run_mutant(root, folder, 0, SURVIVING, script, 60.0, copies=copies)

        with copies.lease() as slot:
            copy = slot.prepare()

            assert (copy.path / "target" / "debug" / "a").read_text() == "x"
            assert not (copy.path / "elsewhere").exists()
    finally:
        remove_work_folder(folder)


def test_gradle_build_and_cache_folders_beside_a_build_file_survive(tmp_path, work):
    root = make_repository(
        tmp_path / "r",
        {"build.gradle.kts": "plugins {}\n", "m.py": MODULE, "test_m.py": TESTS},
    )
    git_commit(root)
    folder = new_work_folder(root)
    copies = MutantCopies(root, folder, 1)
    script = [
        sys.executable,
        "-c",
        "import os; os.makedirs('build/classes'); open('build/classes/a','w').write('x');"
        "os.makedirs('.gradle/v'); open('.gradle/v/b','w').write('x');"
        "os.makedirs('elsewhere'); open('elsewhere/c','w').write('x')",
    ]

    try:
        run_mutant(root, folder, 0, SURVIVING, script, 60.0, copies=copies)

        with copies.lease() as slot:
            copy = slot.prepare()

            assert (copy.path / "build" / "classes" / "a").read_text() == "x"
            assert (copy.path / ".gradle" / "v" / "b").read_text() == "x"
            assert not (copy.path / "elsewhere").exists()
    finally:
        remove_work_folder(folder)


def test_a_timed_out_run_retires_the_copy(project, work):
    copies = MutantCopies(project, work, 1)
    slow = [sys.executable, "-c", "import time; time.sleep(30)"]

    assert run_mutant(project, work, 0, SURVIVING, slow, 0.5, copies=copies).verdict == "timeout"
    assert copies.slots[0].copy is None
    assert not (work / "mutant-0").exists()
    assert verdicts(project, work, [KILLING], PLAIN, copies) == ["killed"]


def test_a_command_that_cannot_start_retires_the_copy(project, work):
    copies = MutantCopies(project, work, 1)

    run_mutant(project, work, 0, SURVIVING, ["/nonexistent/tool"], 5.0, copies=copies)

    assert copies.slots[0].copy is None
    assert verdicts(project, work, [SURVIVING], PLAIN, copies) == ["survived"]


def test_a_stop_while_leased_retires_the_copy(project, work, monkeypatch):
    copies = MutantCopies(project, work, 1)

    def stopping(command, cwd, timeout, environment=None):
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


@needs_uv
def test_the_editable_override_is_set_exactly_when_an_environment_is_leased(
    project, work, monkeypatch
):
    subprocess.run(["uv", "lock", "-q"], cwd=project, check=True, capture_output=True)
    git_commit(project)

    monkeypatch.setenv("UV_NO_EDITABLE", "1")

    seen = []
    real = subprocess.Popen

    def spy(*args, **kwargs):
        if "env" in kwargs:
            seen.append(
                (kwargs["env"].get("UV_NO_EDITABLE"), "UV_PROJECT_ENVIRONMENT" in kwargs["env"])
            )

        return real(*args, **kwargs)

    monkeypatch.setattr(runner.subprocess, "Popen", spy)

    copies = MutantCopies(project, work, 1)
    pool = EnvironmentPool(project, work, 1)

    try:
        order = [KILLING, SURVIVING]

        assert verdicts(project, work, order, UV, copies, pool) == expected(order)
    finally:
        remove_work_folder(pool.folder)

    assert seen and set(seen) == {("0", True)}

    seen.clear()
    run_mutant(project, work, 0, SURVIVING, PLAIN, 120.0, copies=copies)

    assert [flag for flag, _ in seen] == ["1"]
