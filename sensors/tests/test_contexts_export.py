import json
import subprocess
import sys

import coverage
import pytest

from recognizer_sensors.testrun import profiles
from recognizer_sensors.testrun.plugin import recognizer_covctx_export as export

FILE_LINES = "def f(a):\n    return a\n"


def write_data(tmp_path, contexts_by_line):
    source = tmp_path / "m.py"
    source.write_text(FILE_LINES)
    data = coverage.CoverageData(basename=str(tmp_path / "cov.data"))

    for context, lines in contexts_by_line.items():
        data.set_context(context)
        data.add_lines({str(source): lines})

    data.write()

    return str(tmp_path / "cov.data"), str(source)


def exported(tmp_path, data_file):
    output = tmp_path / "out.json"
    export.export(data_file, str(output))

    return json.loads(output.read_text())


def test_a_line_keeps_the_node_ids_that_covered_it(tmp_path):
    data_file, source = write_data(
        tmp_path, {"t/test_a.py::test_x[1-a]": [1, 2], "t/test_b.py::test_y": [2]}
    )
    contexts = exported(tmp_path, data_file)["files"][source]["contexts"]

    assert contexts == {
        "1": ["t/test_a.py::test_x[1-a]"],
        "2": ["t/test_a.py::test_x[1-a]", "t/test_b.py::test_y"],
    }


def test_a_line_covered_by_many_tests_is_reduced_to_their_files(tmp_path):
    ids = {f"t/test_{n}.py::test_{m}": [1] for n in range(3) for m in range(export.MAX_IDS)}
    data_file, source = write_data(tmp_path, ids)
    contexts = exported(tmp_path, data_file)["files"][source]["contexts"]

    assert contexts == {"1": ["t/test_0.py", "t/test_1.py", "t/test_2.py"]}


def test_a_line_covered_by_too_many_files_is_left_out(tmp_path):
    ids = {f"t/test_{n}.py::test_a": [1] for n in range(export.MAX_IDS + 1)}
    ids["t/test_0.py::test_b"] = [2]
    data_file, source = write_data(tmp_path, ids)
    contexts = exported(tmp_path, data_file)["files"][source]["contexts"]

    assert contexts == {"2": ["t/test_0.py::test_b"]}


def test_a_line_run_outside_any_test_keeps_the_empty_context_only(tmp_path):
    data_file, source = write_data(tmp_path, {"": [1], "t/test_a.py::test_x": [1]})

    assert exported(tmp_path, data_file)["files"][source]["contexts"] == {"1": [""]}


def test_the_artifact_stays_within_its_byte_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(export, "BUDGET_BYTES", 10)
    data_file, _ = write_data(tmp_path, {"t/test_a.py::test_x": [1]})

    assert exported(tmp_path, data_file) == {"files": {}}


def test_the_artifact_size_does_not_grow_with_the_number_of_tests(tmp_path):
    ids = {f"t/test_{n % 40}.py::test_{n}": [1, 2] for n in range(3000)}
    data_file, _ = write_data(tmp_path, ids)
    export.export(data_file, str(tmp_path / "out.json"))

    assert (tmp_path / "out.json").stat().st_size < 5000


def test_the_module_runs_as_a_script_over_the_plugin_directory(tmp_path):
    data_file, source = write_data(tmp_path, {"t/test_a.py::test_x": [1]})
    output = tmp_path / "out.json"
    subprocess.run(
        [sys.executable, "-m", "recognizer_covctx_export", data_file, str(output)],
        check=True,
        env={"PYTHONPATH": str(profiles.PLUGIN_DIRECTORY)},
    )

    assert json.loads(output.read_text())["files"][source]["contexts"] == {
        "1": ["t/test_a.py::test_x"]
    }


@pytest.mark.parametrize(
    "runner, interpreter",
    [(["python3", "-m"], ["python3"]), (["uv", "run"], ["uv", "run", "python"])],
)
def test_the_interpreter_follows_the_runner(runner, interpreter):
    assert profiles.python_interpreter(runner) == interpreter
