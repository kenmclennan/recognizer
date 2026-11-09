import importlib.util
from pathlib import Path

from coverage import CoverageData

REPOSITORY = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location(
    "selection_spread", REPOSITORY / "validation" / "mutation" / "selection_spread.py"
)
spread_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(spread_tool)


def test_the_spread_counts_lines_by_covering_files_and_the_half_suite_boundary(tmp_path):
    for n in range(4):
        (tmp_path / f"t{n}.py").write_text("")

    (tmp_path / "a.py").write_text("")
    data = CoverageData(basename=str(tmp_path / "python.data"))
    contexts = {
        1: ["t0.py"],
        2: ["t0.py", "t1.py"],
        3: ["t0.py", "t1.py", "t2.py"],
        4: ["t0.py", "t1.py", "t2.py", "t3.py"],
        5: [""],
        6: ["missing.py"],
    }

    for context in ["t0.py", "t1.py", "t2.py", "t3.py", "", "missing.py"]:
        data.set_context(context)
        data.add_lines({str(tmp_path / "a.py"): [n for n, c in contexts.items() if context in c]})

    data.write()

    assert spread_tool.spread(tmp_path / "python.data", tmp_path) == {
        "suite_files": 4,
        "lines_by_file_count": {1: 1, 2: 1, 3: 1, 4: 1},
        "above_cap": 0,
        "above_half_the_suite": 2,
        "unselectable": 2,
    }
