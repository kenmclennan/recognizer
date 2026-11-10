import sys
import xml.etree.ElementTree as ElementTree
from pathlib import Path

from recognizer_sensors.crap.lcov import Coverage


def merge_coverage(into: Coverage, other: Coverage) -> None:
    for path, lines in other.items():
        target = into.setdefault(path, {})

        for number, hits in lines.items():
            target[number] = target.get(number, 0) + hits


CONVENTIONAL_ROOTS = ("src/main/kotlin/", "src/main/java/", "src/test/")


def project_of_report(repository: Path, report: Path) -> str | None:
    try:
        project = report.resolve().parents[4].relative_to(repository.resolve())
    except (IndexError, ValueError):
        return None

    return "" if str(project) == "." else project.as_posix()


def inside(project: str, path: str) -> bool:
    return not project or path.startswith(project + "/")


def break_tie(matches: list[str], project: str | None) -> str | None:
    if project is not None:
        within = [m for m in matches if inside(project, m)]

        if len(within) == 1:
            return within[0]

        if within:
            matches = within

    conventional = [m for m in matches if any(root in m for root in CONVENTIONAL_ROOTS)]

    return conventional[0] if len(conventional) == 1 else None


def parse_jacoco(text: str, files: list[str], project: str | None = None) -> Coverage | None:
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return None

    coverage: Coverage = {}
    total = 0
    unmatched: list[str] = []

    for package in root.iter("package"):
        for source in package.findall("sourcefile"):
            suffix = f"{package.get('name', '')}/{source.get('name', '')}".lstrip("/")
            matches = [f for f in files if f == suffix or f.endswith("/" + suffix)]

            total += 1

            if len(matches) > 1:
                resolved = break_tie(matches, project)
                matches = [resolved] if resolved else []

            if len(matches) != 1:
                unmatched.append(suffix)

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

    if unmatched:
        examples = ", ".join(unmatched[:3])
        print(
            f"jacoco: {len(unmatched)} of {total} source files matched no single scanned file"
            f" (e.g. {examples})",
            file=sys.stderr,
        )

    return {path: lines for path, lines in coverage.items() if lines}
