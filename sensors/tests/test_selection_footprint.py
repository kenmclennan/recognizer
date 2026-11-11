import tracemalloc
from pathlib import Path

import pytest

from recognizer_sensors.mutation import warmup
from recognizer_sensors.mutation.record import (
    RECORD_VERSION,
    build_record,
    command_hash,
    read_record,
)
from recognizer_sensors.mutation.runner import StoppedBeforeMutation
from recognizer_sensors.settings import MeasurementError
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


def fake_steps(monkeypatch, copy, base, writer, sizes, fail_at=None, stop_at=None):
    count = {"n": 0}

    def fake(repository, where, suite, label, command):
        sizes.append(tree_bytes(copy / base))
        number = count["n"]
        count["n"] += 1

        if stop_at == number:
            raise StoppedBeforeMutation

        if fail_at == number:
            raise MeasurementError("the test command exited 1")

        writer(command)

        return ""

    monkeypatch.setattr(warmup, "warm_step", fake)


def rust_writer(command):
    Path(option(command, "--output-path")).write_text(lcov([1, 2, 3]))


def rust_run(monkeypatch, tmp_path, count, **kwargs):
    copy = tmp_path / f"u{count}"
    copy.mkdir()
    monkeypatch.chdir(copy)
    units = {f"t{n}": ("pkg", "test", f"t{n}") for n in range(count)}
    monkeypatch.setattr(warmup, "rust_units", lambda where, suite: units)
    sizes = []
    fake_steps(monkeypatch, copy, warmup.RUST_BY_TARGET_DIRECTORY, rust_writer, sizes, **kwargs)

    return copy, sizes, warmup.rust_selection(copy, copy, None, whole_of([1, 2, 3]))


def test_rust_by_target_reports_are_deleted_as_they_are_read(monkeypatch, tmp_path):
    root4, sizes4, selection4 = rust_run(monkeypatch, tmp_path, 4)
    root8, sizes8, selection8 = rust_run(monkeypatch, tmp_path, 8)

    assert not (root4 / warmup.RUST_BY_TARGET_DIRECTORY).exists()
    assert not (root8 / warmup.RUST_BY_TARGET_DIRECTORY).exists()
    assert max(sizes4) == max(sizes8)
    assert len(selection8["src/lib.ts"][3]) == 8
    assert len(selection4["src/lib.ts"][3]) == 4


def test_a_failing_rust_step_leaves_no_tree_and_no_selection(monkeypatch, tmp_path):
    root, _, selection = rust_run(monkeypatch, tmp_path, 4, fail_at=2)

    assert selection == {}
    assert not (root / warmup.RUST_BY_TARGET_DIRECTORY).exists()


def csharp_writer(command):
    directory = Path(option(command, "--results-directory"))
    (directory / "guid").mkdir(parents=True, exist_ok=True)
    (directory / "guid" / "coverage.info").write_text(lcov([1, 2, 3]))
    (directory / "results_a.trx").write_text("")


def csharp_run(monkeypatch, tmp_path, count, **kwargs):
    copy = tmp_path / f"c{count}"
    (copy / "TestResults").mkdir(parents=True)
    (copy / "TestResults" / "results_all.trx").write_text("")
    monkeypatch.chdir(copy)
    mapped = {f"T{n}.cs": [f"C{n}"] for n in range(count)}
    names = sorted(mapped)

    def classes(files):
        parent = files[0].parent.name if files else ""

        if parent.isdigit():
            return set(mapped[names[int(parent)]])

        return {c for value in mapped.values() for c in value}

    monkeypatch.setattr(warmup, "csharp_trx_classes", classes)
    monkeypatch.setattr(warmup, "csharp_class_map", lambda repository, found: mapped)
    sizes = []
    fake_steps(monkeypatch, copy, warmup.CSHARP_BY_FILE_DIRECTORY, csharp_writer, sizes, **kwargs)

    return copy, sizes, warmup.csharp_selection(copy, copy, None, whole_of([1, 2, 3]), 0.0)


def test_csharp_by_file_results_are_deleted_as_they_are_read(monkeypatch, tmp_path):
    root4, sizes4, selection4 = csharp_run(monkeypatch, tmp_path, 4)
    root8, sizes8, selection8 = csharp_run(monkeypatch, tmp_path, 8)

    assert not (root4 / warmup.CSHARP_BY_FILE_DIRECTORY).exists()
    assert not (root8 / warmup.CSHARP_BY_FILE_DIRECTORY).exists()
    assert max(sizes4) == max(sizes8)
    assert len(selection8["src/lib.ts"][1]) == 8
    assert len(selection4["src/lib.ts"][1]) == 4


def test_a_failing_csharp_step_leaves_no_tree_and_no_selection(monkeypatch, tmp_path):
    root, _, selection = csharp_run(monkeypatch, tmp_path, 4, fail_at=1)

    assert selection == {}
    assert not (root / warmup.CSHARP_BY_FILE_DIRECTORY).exists()


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


def sites(count, ran, killer=None):
    return [{"ran": dict(ran), "killer": dict(killer or ran)} for _ in range(count)]


def written(functions, tmp_path):
    import json

    record = build_record("cmd", "c", "s", functions, [])
    path = tmp_path / "record.json"
    path.write_text(json.dumps(record))

    return record, path


def test_a_record_stores_each_pair_and_each_set_once_however_many_sites_use_them(tmp_path):
    files = {f"tests/t{n}.py": f"h{n}" for n in range(20)}
    functions = {
        f"f{k}": {"body": "b", "verdicts": ["killed"] * 5, "sites": sites(5, files)}
        for k in range(30)
    }
    record, path = written(functions, tmp_path)

    assert record["record_version"] == RECORD_VERSION == 3
    assert len(record["files"]) == 20
    assert len(record["sets"]) == 1
    assert record["functions"]["f0"]["sites"][0] == {"ran": 0, "killer": 0}

    read = read_record(path, "cmd")

    assert read["functions"]["f29"]["sites"][4]["ran"] == files
    assert read["functions"]["f0"]["sites"][0]["ran"] is read["functions"]["f29"]["sites"][4]["ran"]


def test_a_record_round_trips_empty_null_and_timeout_sites(tmp_path):
    functions = {
        "f": {
            "body": "b",
            "verdicts": ["killed", "survived", "killed", None],
            "sites": [
                {"ran": {}, "killer": {}},
                {"ran": {"t.py": "h"}, "killer": None},
                {"ran": None, "killer": None, "tests": "x"},
                None,
            ],
        }
    }
    record, path = written(functions, tmp_path)
    sites_ = record["functions"]["f"]["sites"]

    assert sites_[0]["ran"] == sites_[0]["killer"]
    assert read_record(path, "cmd")["functions"] == functions


@pytest.mark.parametrize(
    "damage",
    [
        lambda r: r["functions"]["f"]["sites"][0].update(ran=9),
        lambda r: r["functions"]["f"]["sites"][0].update(ran="0"),
        lambda r: r["functions"]["f"]["sites"][0].update(ran=True),
        lambda r: r["sets"].append([7]),
        lambda r: r.pop("files"),
        lambda r: r.update(record_version=2),
    ],
    ids=["out-of-range", "non-integer", "boolean", "missing-file", "no-files", "version-two"],
)
def test_a_record_with_an_unresolvable_id_reads_as_none_whole(tmp_path, damage):
    import json

    functions = {
        "f": {
            "body": "b",
            "verdicts": ["killed", "killed"],
            "sites": sites(1, {"t.py": "h"}) + sites(1, {"u.py": "g"}),
        }
    }
    record, path = written(functions, tmp_path)
    damage(record)
    path.write_text(json.dumps(record))

    assert command_hash("cmd") == record["command"]
    assert read_record(path, "cmd") is None
