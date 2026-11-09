import json
import sys
from collections import Counter
from pathlib import Path

from coverage import CoverageData

from recognizer_sensors.crap.lcov import normalise_path
from recognizer_sensors.testrun.profiles import MAX_SELECTED_FILES
from recognizer_sensors.testrun.run import usable_contexts


def spread(data_path: Path, repository: Path) -> dict:
    data = CoverageData(basename=str(data_path))
    data.read()
    counts: Counter = Counter()
    suite: set[str] = set()
    recorded = 0

    for raw in data.measured_files():
        if normalise_path(raw, repository) is None:
            continue

        for names in data.contexts_by_lineno(raw).values():
            if not names:
                continue

            recorded += 1
            tests = usable_contexts(names, repository)

            if tests:
                counts[len(tests)] += 1
                suite.update(tests)

    covered = sum(counts.values())

    return {
        "suite_files": len(suite),
        "lines_by_file_count": dict(sorted(counts.items())),
        "above_cap": sum(n for size, n in counts.items() if size > MAX_SELECTED_FILES),
        "above_half_the_suite": sum(n for size, n in counts.items() if size * 2 > len(suite)),
        "unselectable": recorded - covered,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: selection_spread.py <python.data> <repository>", file=sys.stderr)

        return 2

    print(json.dumps(spread(Path(argv[1]), Path(argv[2]).resolve()), indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
