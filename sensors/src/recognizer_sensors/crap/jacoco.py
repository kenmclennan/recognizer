import xml.etree.ElementTree as ElementTree

from recognizer_sensors.crap.lcov import Coverage


def merge_coverage(into: Coverage, other: Coverage) -> None:
    for path, lines in other.items():
        target = into.setdefault(path, {})

        for number, hits in lines.items():
            target[number] = target.get(number, 0) + hits


def parse_jacoco(text: str, files: list[str]) -> Coverage | None:
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return None

    coverage: Coverage = {}

    for package in root.iter("package"):
        for source in package.findall("sourcefile"):
            suffix = f"{package.get('name', '')}/{source.get('name', '')}".lstrip("/")
            matches = [f for f in files if f == suffix or f.endswith("/" + suffix)]

            if len(matches) != 1:
                continue

            lines = coverage.setdefault(matches[0], {})

            for line in source.findall("line"):
                try:
                    number = int(line.get("nr", ""))
                    missed = int(line.get("mi", "0"))
                    covered = int(line.get("ci", "0"))
                except ValueError:
                    continue

                if covered > 0:
                    lines[number] = lines.get(number, 0) + covered
                elif missed > 0:
                    lines.setdefault(number, 0)

    return {path: lines for path, lines in coverage.items() if lines}
