import os
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import git_commit, make_repository

from recognizer_sensors.mutation import runner
from recognizer_sensors.mutation.runner import (
    ENVIRONMENTS,
    EnvironmentPool,
    Mutant,
    new_work_folder,
    remove_stale_work_folders,
    remove_work_folder,
    run_mutant,
)

pytestmark = pytest.mark.skipif(shutil.which("uv") is None, reason="needs uv on PATH")

PYPROJECT = '[project]\nname = "t"\nversion = "0"\nrequires-python = ">=3.11"\n'

MODULE = "def f(a):\n    if a:\n        return 1\n    return 2\n\n\ndef g(a):\n    return a\n"

TESTS = "from m import f, g\n\n\ndef test_f():\n    assert f(1) == 1\n\n\ndef test_g():\n    assert g(a=2) == 2\n"

COMMAND = ["uv", "run", "pytest", "-q", "-p", "no:cacheprovider"]


def mutant(old: str, new: str) -> Mutant:
    source = MODULE.encode()
    start = source.index(old.encode())

    return Mutant("m.py", source, start, start + len(old), new.encode())


KILLING = mutant("return 1", "return 3")
SURVIVING = mutant("return 2", "return 3")


@pytest.fixture
def project(tmp_path):
    root = make_repository(
        tmp_path / "p", {"pyproject.toml": PYPROJECT, "m.py": MODULE, "test_m.py": TESTS}
    )
    subprocess.run(["uv", "lock", "-q"], cwd=root, check=True, capture_output=True)
    git_commit(root)

    return root


@pytest.fixture
def run(project):
    work = new_work_folder(project)
    pool = EnvironmentPool(project, work, 2)

    yield project, work, pool

    remove_work_folder(work)
    remove_work_folder(pool.folder)


@pytest.mark.parametrize("order", [(KILLING, SURVIVING), (SURVIVING, KILLING)])
def test_a_mutants_verdict_never_depends_on_the_mutant_before_it(run, order):
    project, work, pool = run
    pool = EnvironmentPool(project, work, 1)
    verdicts = [
        run_mutant(project, work, number, item, COMMAND, 120.0, environments=pool).verdict
        for number, item in enumerate(order)
    ]

    assert verdicts == ["killed" if item is KILLING else "survived" for item in order]


def test_each_mutant_copy_has_a_path_no_earlier_copy_had(run, monkeypatch):
    project, work, pool = run
    pool = EnvironmentPool(project, work, 1)
    seen = []
    real = runner.run_test_command

    def spy(command, cwd, timeout, environment=None):
        seen.append((cwd, environment))

        return real(command, cwd, timeout, environment=environment)

    monkeypatch.setattr(runner, "run_test_command", spy)

    for number in (0, 1, 2):
        run_mutant(project, work, number, SURVIVING, COMMAND, 120.0, environments=pool)

    copies = [cwd for cwd, _ in seen if cwd != project]
    environments = {environment for _, environment in seen}

    assert len(set(copies)) == 3
    assert len(environments) == 1
    assert next(iter(environments)).parent == project / ENVIRONMENTS / work.name
    assert not any(project / ENVIRONMENTS in [*copy.parents] for copy in copies)


def test_the_pool_holds_one_environment_per_slot_and_none_inside_a_copy(run, monkeypatch):
    project, work, pool = run
    real = runner.run_test_command
    most = []
    inside = []
    lock = threading.Lock()

    def spy(command, cwd, timeout, environment=None):
        folders = [p for p in pool.folder.iterdir() if p.is_dir()]

        with lock:
            most.append(len(folders))
            inside.append((cwd / ".recognizer/cache/python-env").exists())

        return real(command, cwd, timeout, environment=environment)

    monkeypatch.setattr(runner, "run_test_command", spy)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                run_mutant, project, work, number, SURVIVING, COMMAND, 120.0, environments=pool
            )
            for number in range(6)
        ]
        verdicts = [future.result().verdict for future in futures]

    assert verdicts == ["survived"] * 6
    assert 1 <= max(most) <= 2
    assert not any(inside)

    remove_work_folder(pool.folder)

    assert not pool.folder.exists()


def test_without_a_lockfile_no_environment_folder_exists_and_no_environment_is_passed(
    tmp_path, monkeypatch
):
    root = make_repository(tmp_path / "q", {"m.py": MODULE, "test_m.py": TESTS})
    git_commit(root)
    work = new_work_folder(root)
    pool = EnvironmentPool(root, work, 2)
    calls = []

    def spy(command, cwd, timeout):
        calls.append(command)
        from recognizer_sensors.mutation.runner import TestRun

        return TestRun(0, False, 0.0, "")

    monkeypatch.setattr(runner, "run_test_command", spy)

    result = run_mutant(root, work, 0, SURVIVING, ["x"], 1.0, environments=pool)

    assert result.verdict == "survived"
    assert calls == [["x"]]
    assert not (root / ENVIRONMENTS).exists()

    remove_work_folder(work)


def test_a_dead_runs_environment_folder_is_swept_and_a_live_one_is_kept(run):
    project, work, pool = run
    pool.prepare()
    dead = pool.folder.parent / "0-dead"
    dead.mkdir()
    (dead / "pid").write_text("0")
    live = pool.folder.parent / f"{os.getpid()}-live"
    live.mkdir()
    (live / "pid").write_text(str(os.getpid()))

    remove_stale_work_folders(pool.folder)

    assert not dead.exists()
    assert live.exists()
    assert pool.folder.exists()


def test_the_environment_folder_parent_is_excluded_from_backup(run, monkeypatch):
    project, work, pool = run
    marked = []
    monkeypatch.setattr(runner, "exclude_from_backup", marked.append)

    pool.prepare()

    assert marked == [pool.folder.parent]


def test_a_failing_warm_up_is_a_red_test_run_not_an_exception(run, monkeypatch):
    project, work, pool = run
    monkeypatch.setattr(runner, "WARM_COMMAND", ["false"])

    result = run_mutant(
        project, work, 0, SURVIVING, ["sh", "-c", "exit 1"], 30.0, environments=pool
    )

    assert result.verdict == "killed"
