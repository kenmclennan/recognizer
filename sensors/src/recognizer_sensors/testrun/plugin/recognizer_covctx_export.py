import json
import sys

import coverage

MAX_IDS = 50

BUDGET_BYTES = 100_000_000


def bounded(names):
    names = sorted(names)

    if "" in names:
        return [""]

    if len(names) <= MAX_IDS:
        return names

    files = sorted({name.split("::", 1)[0] for name in names})

    return files if len(files) <= MAX_IDS else None


def file_entry(data, path):
    lines = {}

    for number, names in data.contexts_by_lineno(path).items():
        kept = bounded(names)

        if kept is not None:
            lines[str(number)] = kept

    return lines


def export(data_file, output):
    data = coverage.CoverageData(basename=data_file)
    data.read()
    written = 0

    with open(output, "w", encoding="utf-8") as stream:
        stream.write('{"files":{')
        first = True

        for path in sorted(data.measured_files()):
            lines = file_entry(data, path)
            chunk = json.dumps({path: {"contexts": lines}}, separators=(",", ":"))[1:-1]

            if written + len(chunk) > BUDGET_BYTES:
                break

            stream.write(chunk if first else "," + chunk)
            written += len(chunk) + 1
            first = False

        stream.write("}}")


if __name__ == "__main__":
    export(sys.argv[1], sys.argv[2])
