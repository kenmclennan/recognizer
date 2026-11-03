import importlib.util
import json
from pathlib import Path

REPOSITORY = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location(
    "selection_spread", REPOSITORY / "validation" / "mutation" / "selection_spread.py"
)
spread_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(spread_tool)


def test_the_spread_counts_lines_by_covering_files_and_the_half_suite_boundary(tmp_path):
    for n in range(4):
        (tmp_path / f"t{n}.py").write_text("")

    names = [f"t{n}.py" for n in range(4)]
    contexts = {
        "1": names[:1],
        "2": names[:2],
        "3": names[:3],
        "4": names[:4],
        "5": [""],
        "6": ["missing.py"],
    }
    text = json.dumps({"files": {"a.py": {"contexts": contexts}}})

    assert spread_tool.spread(text, tmp_path) == {
        "suite_files": 4,
        "lines_by_file_count": {1: 1, 2: 1, 3: 1, 4: 1},
        "above_cap": 0,
        "above_half_the_suite": 2,
        "unselectable": 2,
    }
