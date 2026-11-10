import tracemalloc
from pathlib import Path
from types import SimpleNamespace

import pytest

from recognizer_sensors.mutation.runner import StoppedBeforeMutation
from recognizer_sensors.settings import MeasurementError
from recognizer_sensors.testrun import run
from recognizer_sensors.testrun.selection import SelectionBuilder

MODULE = "src/lib.py"


def tree_bytes(directory):
    if not directory.exists():
        return 0

    return sum(path.stat().st_size for path in directory.rglob("*") if path.is_file())


def option(command, name):
    return command[command.index(name) + 1]


def lcov(lines):
    body = "".join(f"DA:{n},1\n" for n in lines)

    return f"SF:src/lib.ts\n{body}end_of_record\n"


def whole_of(lines):
    return {"src/lib.ts": {n: 1 for n in lines}}


def fake_steps(monkeypatch, root, base, writer, sizes, fail_at=None, stop_at=None):
    count = {"n": 0}

    def fake(repository, steps, mode="w", strict=False):
        for step in steps:
            sizes.append(tree_bytes(root / base))
            number = count["n"]
            count["n"] += 1

            if stop_at == number:
                raise StoppedBeforeMutation

            if fail_at == number:
                raise MeasurementError("the test command exited 1")

            writer(step.command)

        return []

    monkeypatch.setattr(run, "run_steps", fake)


def typescript_writer(command):
    directory = Path(option(command, "--reports-dir"))
    (directory / "tmp").mkdir(parents=True, exist_ok=True)
    (directory / "tmp" / "coverage-1.json").write_text("x" * 5000)
    (directory / "lcov.info").write_text(lcov([1, 2, 3]))


def scan_of(files):
    return SimpleNamespace(language="typescript", modules=[SimpleNamespace(files=files)])


def typescript_run(monkeypatch, tmp_path, count, **kwargs):
    root = tmp_path / f"r{count}"
    root.mkdir()
    monkeypatch.chdir(root)
    sizes = []
    fake_steps(monkeypatch, root, run.BY_FILE_DIRECTORY, typescript_writer, sizes, **kwargs)
    files = [f"test/t{n}.test.ts" for n in range(count)]
    selection = run.typescript_selection(root, scan_of(files), whole_of([1, 2, 3]))

    return root, sizes, selection


def test_typescript_by_file_reports_are_deleted_as_they_are_read(monkeypatch, tmp_path):
    root4, sizes4, selection4 = typescript_run(monkeypatch, tmp_path, 4)
    root8, sizes8, selection8 = typescript_run(monkeypatch, tmp_path, 8)

    assert not (root4 / run.BY_FILE_DIRECTORY).exists()
    assert not (root8 / run.BY_FILE_DIRECTORY).exists()
    assert max(sizes4) == max(sizes8)
    assert len(selection8["src/lib.ts"][1]) == 8
    assert selection4["src/lib.ts"][2] == frozenset(f"test/t{n}.test.ts" for n in range(4))


def test_a_failing_typescript_step_leaves_no_tree_and_no_selection(monkeypatch, tmp_path):
    root, _, selection = typescript_run(monkeypatch, tmp_path, 4, fail_at=1)

    assert selection == {}
    assert not (root / run.BY_FILE_DIRECTORY).exists()


def test_a_stopped_typescript_run_leaves_no_tree(monkeypatch, tmp_path):
    root = tmp_path / "r"
    root.mkdir()
    monkeypatch.chdir(root)
    fake_steps(monkeypatch, root, run.BY_FILE_DIRECTORY, typescript_writer, [], stop_at=1)

    with pytest.raises(StoppedBeforeMutation):
        run.typescript_selection(root, scan_of(["test/a.test.ts", "test/b.test.ts"]), whole_of([1]))

    assert not (root / run.BY_FILE_DIRECTORY).exists()


def test_the_selection_builder_shares_one_frozenset_per_distinct_set():
    builder = SelectionBuilder()
    builder.add("a", {"m": {1: 1, 2: 1, 3: 0}})
    builder.add("b", {"m": {1: 1, 2: 1}})
    builder.add("c", {"m": {2: 1}})
    selection = builder.build({"m": {1: 1, 2: 1, 3: 1}})

    assert selection == {"m": {1: frozenset("ab"), 2: frozenset("abc")}}
    assert selection["m"][1] is not selection["m"][2]

    other = SelectionBuilder()
    other.add("a", {"m": {1: 1, 2: 1, 5: 1}})
    other.add("b", {"m": {1: 1, 2: 1, 5: 1}})
    shared = other.build({"m": {1: 1, 2: 1, 5: 1}})

    assert shared["m"][1] is shared["m"][2] is shared["m"][5]


def retained(tests):
    lines = {n: 1 for n in range(5000)}
    builder = SelectionBuilder()
    tracemalloc.start()
    before = tracemalloc.get_traced_memory()[0]

    for n in range(tests):
        builder.add(f"tests/test_{n}.py", {"m": lines})

    selection = builder.build({"m": lines})
    del builder
    after = tracemalloc.get_traced_memory()[0]
    tracemalloc.stop()

    return after - before, len({id(files) for files in selection["m"].values()})


def test_doubling_the_test_files_over_the_same_lines_keeps_the_selection_the_same_size():
    small, small_objects = retained(40)
    large, large_objects = retained(80)

    assert large_objects == small_objects == 1
    assert large < small * 1.1
