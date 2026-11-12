import sys

import pytest
from conftest import git_commit, make_repository
from coverage import CoverageData
from test_mutation_selection import write_data

from recognizer_sensors.mutation.warmup import coverage_run
from recognizer_sensors.scans import read_scans
from recognizer_sensors.settings import Refusal
from recognizer_sensors.testrun.contexts import PYTHON_DATA, PythonContexts
from recognizer_sensors.testrun.readiness import lacks_contexts
from recognizer_sensors.testrun.suites import parse_suites

SHOP = """def body_only(x):
    return x + 1


def with_fixture(x):
    return x + 2
"""

TEST_SHOP = """import pytest

from app.shop import body_only, with_fixture


@pytest.fixture
def prepared():
    return with_fixture(1)


def test_body(prepared):
    assert body_only(1) == 2
    assert prepared == 3


def test_again():
    assert with_fixture(1) == 3
"""

RUN = f"{sys.executable} -m coverage run -m pytest tests -q -p no:cacheprovider\n"
LCOV = f"{sys.executable} -m coverage lcov -o coverage/lcov.info\n"
SCRIPT = f"{RUN.rstrip()} || exit 1\nmkdir -p coverage\n{LCOV}"


def suite_raw(name="api", directory=".", command="sh run.sh"):
    return {
        "name": name,
        "language": "python",
        "directory": directory,
        "command": command,
        "coverage": {"path": "coverage/lcov.info", "format": "lcov"},
    }


def warm(tmp_path, files, suites):
    root = make_repository(tmp_path / "r", files)
    git_commit(root)
    work = tmp_path / "work"
    work.mkdir()
    scans = [scan for scan in read_scans(root) if scan.language == "python"]

    return coverage_run(root, scans, parse_suites(suites), work)


BASE = {"app/shop.py": SHOP, "tests/test_shop.py": TEST_SHOP, "run.sh": SCRIPT}


def test_a_coverage_run_suite_with_no_dynamic_context_is_refused_with_both_fixes(tmp_path):
    with pytest.raises(Refusal) as refused:
        warm(tmp_path, BASE, [suite_raw()])

    diagnosis = refused.value.diagnosis

    assert diagnosis["code"] == "no-test-contexts"
    assert diagnosis["suite"] == "api"
    assert "api" in diagnosis["line"]
    assert "pytest --cov" in diagnosis["line"]
    assert "dynamic_context = test_function" in diagnosis["line"]


def test_dynamic_context_gives_a_selection_and_a_fixture_run_line_keeps_the_whole_suite(tmp_path):
    files = {**BASE, ".coveragerc": "[run]\ndynamic_context = test_function\n"}

    _, selection = warm(tmp_path, files, [suite_raw()])
    lines = selection["app/shop.py"]

    assert lines
    assert lines[2] == frozenset({"tests/test_shop.py"})
    assert 6 not in lines


def test_only_the_suite_that_records_nothing_is_named(tmp_path):
    files = {
        **BASE,
        ".coveragerc": "[run]\ndynamic_context = test_function\n",
        "other/app/shop.py": SHOP,
        "other/tests/test_shop.py": TEST_SHOP,
        "other/run.sh": SCRIPT,
        "other/.coveragerc": "[run]\nbranch = False\n",
    }
    suites = [suite_raw(), suite_raw("other", "other")]

    with pytest.raises(Refusal) as refused:
        warm(tmp_path, files, suites)

    assert refused.value.diagnosis["suite"] == "other"


def dotted_reader(tmp_path, names, files):
    for name in files:
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text("")

    git_commit(tmp_path)
    write_data(tmp_path, [(name, [1]) for name in names])

    return PythonContexts(tmp_path).lines("app/m.py")


def test_dotted_names_resolve_by_path_by_unique_suffix_and_not_when_ambiguous(tmp_path):
    lines = dotted_reader(
        tmp_path,
        ["tests.unit.test_x.test_a"],
        ["app/m.py", "tests/unit/test_x.py"],
    )

    assert lines[1] == frozenset({"tests/unit/test_x.py"})


def test_a_dotted_suffix_with_one_file_resolves(tmp_path):
    lines = dotted_reader(tmp_path, ["test_x.test_a"], ["app/m.py", "tests/test_x.py"])

    assert lines[1] == frozenset({"tests/test_x.py"})


def test_an_ambiguous_dotted_suffix_is_unselectable(tmp_path):
    lines = dotted_reader(
        tmp_path, ["test_x.test_a"], ["app/m.py", "tests/a/test_x.py", "tests/b/test_x.py"]
    )

    assert lines == {}


def test_an_unknown_dotted_module_is_unselectable(tmp_path):
    assert dotted_reader(tmp_path, ["test_y.test_a"], ["app/m.py", "tests/test_x.py"]) == {}


def test_a_line_the_empty_context_also_ran_is_unselectable(tmp_path):
    lines = dotted_reader(tmp_path, ["", "test_x.test_a"], ["app/m.py", "tests/test_x.py"])

    assert lines == {}


def test_data_holding_only_the_empty_context_records_nothing(tmp_path):
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "m.py").write_text("")
    write_data(tmp_path, [("", [1])])

    reader = PythonContexts(tmp_path)

    assert reader.data is not None
    assert not reader.recorded
    assert (tmp_path / PYTHON_DATA).exists()
    assert CoverageData(basename=str(tmp_path / PYTHON_DATA))


def gap_suite(command, env=None):
    raw = suite_raw(command=command)

    if env:
        raw["env"] = env

    return parse_suites([raw])[0]


@pytest.mark.parametrize(
    "command",
    [
        "coverage run -m pytest tests",
        "python -m coverage run -m pytest -q",
        "uv run coverage run -m pytest",
    ],
)
def test_a_command_that_proves_the_refusal_is_a_gap(tmp_path, command):
    assert lacks_contexts(gap_suite(command), tmp_path)


@pytest.mark.parametrize(
    "command",
    [
        "pytest --cov=app tests",
        "make test",
        "coverage run -m pytest --cov=app",
        "coverage run --rcfile=ci.cfg -m pytest",
        "coverage run -m unittest",
    ],
)
def test_a_command_that_may_record_contexts_is_no_gap(tmp_path, command):
    assert not lacks_contexts(gap_suite(command), tmp_path)


def test_a_coverage_rcfile_in_the_env_is_no_gap(tmp_path):
    suite = gap_suite("coverage run -m pytest", {"COVERAGE_RCFILE": "ci.cfg"})

    assert not lacks_contexts(suite, tmp_path)


@pytest.mark.parametrize("name", [".coveragerc", "setup.cfg", "tox.ini", "pyproject.toml"])
def test_dynamic_context_in_a_coverage_config_file_is_no_gap(tmp_path, name):
    (tmp_path / name).write_text("dynamic_context = test_function\n")

    assert not lacks_contexts(gap_suite("coverage run -m pytest"), tmp_path)


def test_cov_in_a_pytest_config_is_no_gap(tmp_path):
    (tmp_path / "pytest.ini").write_text("[pytest]\naddopts = --cov=app\n")

    assert not lacks_contexts(gap_suite("coverage run -m pytest"), tmp_path)
