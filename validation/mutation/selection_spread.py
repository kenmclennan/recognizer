import json
import sys
from collections import Counter
from pathlib import Path

from recognizer_sensors.testrun.profiles import MAX_SELECTED_FILES
from recognizer_sensors.testrun.run import read_contexts


def spread(text: str, repository: Path) -> dict:
    selection = read_contexts(text, repository)
    suite = {name for lines in selection.values() for files in lines.values() for name in files}
    counts = Counter(len(files) for lines in selection.values() for files in lines.values())
    covered = sum(counts.values())
    recorded = sum(
        1
        for entry in json.loads(text).get("files", {}).values()
        for contexts in entry.get("contexts", {}).values()
        if contexts
    )

    return {
        "suite_files": len(suite),
        "lines_by_file_count": dict(sorted(counts.items())),
        "above_cap": sum(n for size, n in counts.items() if size > MAX_SELECTED_FILES),
        "above_half_the_suite": sum(n for size, n in counts.items() if size * 2 > len(suite)),
        "unselectable": recorded - covered,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: selection_spread.py <python.contexts.json> <repository>", file=sys.stderr)

        return 2

    text = Path(argv[1]).read_text(encoding="utf-8")
    print(json.dumps(spread(text, Path(argv[2]).resolve()), indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
