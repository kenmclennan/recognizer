import gc
import subprocess
import sys
import weakref

import pytest
from coverage import CoverageData

from recognizer_sensors.mutation.warmup import coverage_run, suite_size
from recognizer_sensors.settings import Refusal
from recognizer_sensors.testrun.contexts import (
    PYTHON_DATA,
    ContextSelection,
    PythonContexts,
    node_contexts,
    usable_contexts,
)
from recognizer_sensors.testrun.suites import parse_suites


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
        ("", [4]),
        ("tests/c.py", [3]),
        ("tests/gone.py", [5]),
    ]:
        data.set_context(context)
        data.add_lines({str(tmp_path / "m.py"): lines})

    data.write()

    assert PythonContexts(tmp_path, usable_contexts).suite_files == {
        "tests/a.py",
        "tests/b.py",
        "tests/c.py",
    }


def test_a_warm_up_that_never_starts_leaves_no_data_file_behind(tmp_path, monkeypatch):
    from conftest import make_repository

    from recognizer_sensors.scans import read_scans

    monkeypatch.setenv("SHELL", "/bin/sh")
    root = make_repository(tmp_path / "r", {"app/shop.py": "X = 1\n", "tests/test_a.py": ""})
    work = tmp_path / "work"
    work.mkdir()
    scans = [s for s in read_scans(root) if s.language == "python"]
    suites = parse_suites(
        [
            {
                "name": "api",
                "language": "python",
                "directory": ".",
                "command": "/nonexistent-runner",
                "coverage": {"path": "out/lcov.info", "format": "lcov"},
            }
        ]
    )

    with pytest.raises(Refusal):
        coverage_run(root, scans, suites, work)

    assert not (work / "warmup" / PYTHON_DATA).exists()


def test_context_names_become_the_test_files_that_exist(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_a.py").write_text("")

    run = ["tests/test_a.py::test_x|run"]
    setup = ["tests/test_a.py::test_y[1-2]|setup"]

    assert usable_contexts(run, tmp_path) == {"tests/test_a.py"}
    assert usable_contexts(setup, tmp_path) == {"tests/test_a.py"}
    assert usable_contexts([""], tmp_path) is None
    assert usable_contexts(["", *run], tmp_path) == {"tests/test_a.py"}
    assert usable_contexts([*run, "tests/test_gone.py::test_x|run"], tmp_path) is None


def test_names_under_a_suite_directory_carry_the_directory_prefix(tmp_path):
    (tmp_path / "service" / "tests").mkdir(parents=True)
    (tmp_path / "service" / "tests" / "test_a.py").write_text("")
    (tmp_path / PYTHON_DATA).parent.mkdir(parents=True)
    data = CoverageData(basename=str(tmp_path / PYTHON_DATA))
    (tmp_path / "service" / "m.py").write_text("")
    data.set_context("tests/test_a.py::test_x|run")
    data.add_lines({str(tmp_path / "service" / "m.py"): [1]})
    data.write()

    reader = PythonContexts(tmp_path, directory="service")

    assert reader.lines("service/m.py") == {1: frozenset({"service/tests/test_a.py"})}


def test_the_selection_answers_from_the_eager_dict_and_the_reader(tmp_path):
    build(tmp_path, files=2, tests=2)
    eager = {"other.ts": {1: frozenset({"web/a.test.ts"})}}
    selection = ContextSelection(eager, PythonContexts(tmp_path, usable_contexts))

    assert selection.get("other.ts") == eager["other.ts"]
    assert selection.get("m0.py") == {n: frozenset({"tests/test_0.py"}) for n in (1, 2, 3)}
    assert selection.get("nowhere.py", {}) == {}
    assert suite_size(selection) == 3
    assert suite_size(eager) == 1


def make_tests(tmp_path, *files):
    (tmp_path / "tests").mkdir(exist_ok=True)

    for file in files:
        (tmp_path / "tests" / file).write_text("")


def test_node_contexts_returns_each_node_id_without_its_phase(tmp_path):
    make_tests(tmp_path, "test_a.py")

    assert node_contexts(["tests/test_a.py::t1|run", "tests/test_a.py::t2|setup"], tmp_path) == {
        "tests/test_a.py::t1",
        "tests/test_a.py::t2",
    }


NODE_SHAPES = [
    ("tests/test_a.py::test_t[a|b]|run", "tests/test_a.py::test_t[a|b]"),
    (
        "tests/test_a.py::test_every[hub#detail]@hub#detail|run",
        "tests/test_a.py::test_every[hub#detail]",
    ),
    ("tests/test_a.py::test_t[a@b]|run", "tests/test_a.py::test_t[a@b]"),
    (r"tests/test_a.py::test_t[\u2192]|run", r"tests/test_a.py::test_t[\u2192]"),
]


@pytest.mark.parametrize(("recorded", "expected"), NODE_SHAPES)
def test_node_contexts_normalises_the_recorded_shapes(tmp_path, recorded, expected):
    make_tests(tmp_path, "test_a.py")

    assert node_contexts([recorded], tmp_path) == {expected}


@pytest.mark.parametrize(
    "names",
    [
        [""],
        ["tests/test_a.py"],
        ["tests/missing.py::t|run"],
        ["tests/test_a.py::t|run", "tests/missing.py::t|run"],
        ["tests/test_a.py::t|run", ""],
        None,
    ],
)
def test_node_contexts_is_none_when_any_name_cannot_be_resolved(tmp_path, names):
    make_tests(tmp_path, "test_a.py")

    assert node_contexts(names, tmp_path) is None


@pytest.mark.parametrize(("recorded", "expected"), NODE_SHAPES)
def test_a_normalised_node_id_is_collected_by_pytest_as_one_test(tmp_path, recorded, expected):
    ident = expected.split("[", 1)[1][:-1].replace("\\u2192", "\u2192")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_a.py").write_text(
        "import pytest\n\n\n"
        f"@pytest.mark.parametrize('x', [pytest.param(1, id={ident!r})])\n"
        f"def {expected.split('::', 1)[1].split('[')[0]}(x):\n    pass\n",
        encoding="utf-8",
    )
    found = node_contexts([recorded], tmp_path)
    assert found is not None
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *sorted(found)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "1 passed" in result.stdout


def test_the_python_reader_holds_node_ids_per_line_and_prefixes_the_directory(tmp_path):
    (tmp_path / "svc" / "tests").mkdir(parents=True)
    (tmp_path / "svc" / "app").mkdir()
    (tmp_path / "svc" / "app" / "m.py").write_text("")
    (tmp_path / "svc" / "tests" / "test_a.py").write_text("")
    (tmp_path / PYTHON_DATA).parent.mkdir(parents=True)
    data = CoverageData(basename=str(tmp_path / PYTHON_DATA))
    data.set_context("tests/test_a.py::t1|run")
    data.add_lines({str(tmp_path / "svc" / "app" / "m.py"): [1]})
    data.set_context("")
    data.add_lines({str(tmp_path / "svc" / "app" / "m.py"): [2]})
    data.write()

    reader = PythonContexts(tmp_path, directory="svc")

    assert ContextSelection({}, reader).nodes("svc/app/m.py") == {
        1: frozenset({"svc/tests/test_a.py::t1"})
    }
