import sys
import xml.etree.ElementTree as ElementTree

from recognizer_sensors.crap.lcov import Coverage

CONVENTIONAL_ROOTS = ("/src/main/kotlin/", "/src/main/java/", "/src/test/")
EXAMPLE_LIMIT = 3


def merge_coverage(into: Coverage, other: Coverage) -> None:
    for path, lines in other.items():
        target = into.setdefault(path, {})

        for number, hits in lines.items():
            target[number] = target.get(number, 0) + hits


def module_prefix(report: str | None) -> str | None:
    if not report:
        return None

    parts = report.split("/")

    if "build" not in parts:
        return None

    index = len(parts) - 1 - parts[::-1].index("build")

    return "/".join(parts[:index])


def in_module(path: str, prefix: str) -> bool:
    return path.startswith(f"{prefix}/src/" if prefix else "src/")


def break_tie(matches: list[str], prefix: str | None) -> str | None:
    if prefix is not None:
        inside = [m for m in matches if in_module(m, prefix)]

        if len(inside) == 1:
            return inside[0]

        matches = inside or matches

    conventional = [m for m in matches if any(r in "/" + m for r in CONVENTIONAL_ROOTS)]

    if len(conventional) == 1:
        return conventional[0]

    return None


def parse_jacoco(text: str, files: list[str], report: str | None = None) -> Coverage | None:
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return None

    coverage: Coverage = {}
    prefix = module_prefix(report)
    total = 0
    unmatched: list[str] = []

    for package in root.iter("package"):
        for source in package.findall("sourcefile"):
            suffix = f"{package.get('name', '')}/{source.get('name', '')}".lstrip("/")
            matches = [f for f in files if f == suffix or f.endswith("/" + suffix)]
            total += 1
            chosen = matches[0] if len(matches) == 1 else break_tie(matches, prefix)

            if chosen is None:
                unmatched.append(suffix)
                continue

            lines = coverage.setdefault(chosen, {})

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

    if unmatched and len(unmatched) < total:
        examples = ", ".join(unmatched[:EXAMPLE_LIMIT])
        print(
            f"jacoco: {len(unmatched)} of {total} source files matched no single scanned file"
            f" (e.g. {examples})",
            file=sys.stderr,
        )

    return {path: lines for path, lines in coverage.items() if lines}
