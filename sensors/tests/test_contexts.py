import gc
import weakref

from coverage import CoverageData

from recognizer_sensors.testrun import profiles
from recognizer_sensors.testrun.contexts import ContextSelection, PythonContexts
from recognizer_sensors.testrun.profiles import PYTHON_COVERAGE_CONTEXTS, PYTHON_DATA
from recognizer_sensors.testrun.run import (
    LEGACY_CONTEXTS_PATH,
    collect_coverage_with_tests,
    suite_size,
    usable_contexts,
)


class Lines(dict):
    pass


def build(root, files=40, tests=300):
    (root / "tests").mkdir()

    for n in range(tests):
        (root / "tests" / f"test_{n}.py").write_text("")

    data = CoverageData(basename=str(root / PYTHON_DATA))
    (root / PYTHON_DATA).parent.mkdir(parents=True, exist_ok=True)

    for f in range(files):
        (root / f"m{f}.py").write_text("")

    for n in range(tests):
        data.set_context(f"tests/test_{n}.py")
        data.add_lines(
            {str(root / f"m{f}.py"): [1, 2, 3] for f in range(files) if f % 40 == n % 40}
        )

    data.write()


def spy(monkeypatch):
    calls = []
    alive = []
    real = CoverageData.contexts_by_lineno

    def contexts_by_lineno(self, filename):
        calls.append(filename)
        result = Lines(real(self, filename))
        alive.append(weakref.ref(result))

        return result

    monkeypatch.setattr(CoverageData, "contexts_by_lineno", contexts_by_lineno)

    return calls, alive


def live(alive):
    gc.collect()

    return sum(1 for ref in alive if ref() is not None)


def test_lines_reads_one_file_and_keeps_at_most_one_result_alive(tmp_path, monkeypatch):
    build(tmp_path)
    calls, alive = spy(monkeypatch)
    reader = PythonContexts(tmp_path, usable_contexts)

    assert calls == []
    assert reader.lines("m3.py")
    assert [c.rsplit("/", 1)[-1] for c in calls] == ["m3.py"]

    for path in reader.paths:
        reader.lines(path)

    assert live(alive) <= 1


def test_the_suite_pass_reads_each_file_once_and_keeps_none_of_them(tmp_path, monkeypatch):
    build(tmp_path)
    calls, alive = spy(monkeypatch)
    reader = PythonContexts(tmp_path, usable_contexts)

    assert len(reader.suite_files) == 300
    assert sorted(c.rsplit("/", 1)[-1] for c in calls) == sorted(f"m{f}.py" for f in range(40))
    assert live(alive) == 0


def test_the_suite_counts_only_names_on_kept_lines(tmp_path):
    (tmp_path / "tests").mkdir()

    for name in ("a", "b", "c"):
        (tmp_path / "tests" / f"{name}.py").write_text("")

    (tmp_path / "m.py").write_text("")
    data = CoverageData(basename=str(tmp_path / PYTHON_DATA))
    (tmp_path / PYTHON_DATA).parent.mkdir(parents=True)

    for context, lines in [
        ("tests/a.py", [1]),
        ("tests/b.py", [2]),
        ("", [2]),
        ("tests/c.py", [3]),
    ]:
        data.set_context(context)
        data.add_lines({str(tmp_path / "m.py"): lines})

    data.write()

    assert PythonContexts(tmp_path, usable_contexts).suite_files == {"tests/a.py", "tests/c.py"}


def test_the_command_has_no_json_step():
    assert "show-contexts" not in PYTHON_COVERAGE_CONTEXTS
    assert "coverage json" not in PYTHON_COVERAGE_CONTEXTS


def test_a_pass_that_never_starts_removes_the_stale_data_and_legacy_json(tmp_path, monkeypatch):
    from conftest import make_repository

    from recognizer_sensors.scans import read_scans

    monkeypatch.setattr(profiles, "python_runner", lambda repository: ["/nonexistent-runner"])
    root = make_repository(tmp_path / "r", {"app/shop.py": "X = 1\n", "tests/test_a.py": ""})
    (root / PYTHON_DATA).parent.mkdir(parents=True, exist_ok=True)
    (root / PYTHON_DATA).write_bytes(b"stale")
    (root / LEGACY_CONTEXTS_PATH).write_text("{}")
    scans = [s for s in read_scans(root) if s.language == "python"]

    try:
        collect_coverage_with_tests(root, scans, None)
    except Exception:
        pass

    assert not (root / PYTHON_DATA).exists()
    assert not (root / LEGACY_CONTEXTS_PATH).exists()


def test_the_selection_answers_from_the_eager_dict_and_the_reader(tmp_path):
    build(tmp_path, files=2, tests=2)
    eager = {"other.ts": {1: frozenset({"web/a.test.ts"})}}
    selection = ContextSelection(eager, PythonContexts(tmp_path, usable_contexts))

    assert selection.get("other.ts") == eager["other.ts"]
    assert selection.get("m0.py") == {n: frozenset({"tests/test_0.py"}) for n in (1, 2, 3)}
    assert selection.get("nowhere.py", {}) == {}
    assert suite_size(selection) == 3
    assert suite_size(eager) == 1
