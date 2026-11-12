import re
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap.jacoco import merge_coverage, parse_jacoco
from recognizer_sensors.crap.lcov import Coverage, parse_lcov
from recognizer_sensors.scans import Scan

LOG = Path(".recognizer") / "cache" / "coverage" / "last-run.log"

CACHE_PREFIX = ".recognizer/"

REASON_LIMIT = 200

NANOSECONDS = 1_000_000_000

DECORATION = re.compile(r"^[=!\-\s]*$")


@dataclass(frozen=True)
class Source:
    path: str
    format: str
    prefix: str = ""
    label: str | None = None


def last_meaningful_line(text: str) -> str | None:
    for line in reversed(text.splitlines()):
        if not DECORATION.match(line):
            return " ".join(line.strip("=!- \t").split())

    return None


def exit_reason(subject: str, returncode: int, output: str) -> str:
    reason = f"{subject.strip()} exited {returncode}"
    last = last_meaningful_line(output)

    if last:
        reason = f"{reason}: {last[:REASON_LIMIT]}"

    return f"{reason} (see {LOG.as_posix()})"


def expected_files(source: Source, language: str | None, scans: list[Scan]) -> set[str]:
    return {
        path
        for scan in scans
        if language is None or scan.language == language
        for module in scan.modules
        for path in module.files
        if not source.prefix or path.startswith(f"{source.prefix}/")
    }


def coverage_counts(
    part: Coverage, source: Source, language: str | None, scans: list[Scan]
) -> tuple[int, int]:
    expected = expected_files(source, language, scans)

    return len(expected & part.keys()), len(expected)


def covers_nothing(part: Coverage, source: Source, language: str | None, scans: list[Scan]) -> bool:
    covered, expected = coverage_counts(part, source, language, scans)

    return expected > 0 and covered == 0


def fresh_reports(repository: Path, pattern: str, since: float | None) -> list[Path]:
    matches = sorted(p for p in repository.glob(pattern) if p.is_file())

    if since is None or pattern.startswith(CACHE_PREFIX):
        return matches

    floor = int(since * NANOSECONDS)

    return [p for p in matches if p.stat().st_mtime_ns >= floor]


def parse_matches(
    repository: Path, source: Source, files: list[str], since: float | None
) -> list[Coverage] | None:
    matches = fresh_reports(repository, source.path, since)

    if not matches:
        return None

    parts: list[Coverage] = []

    for match in matches:
        try:
            text = match.read_text(encoding="utf-8")
        except (OSError, ValueError):
            continue

        part = (
            parse_jacoco(text, files, match.relative_to(repository).as_posix())
            if source.format == "jacoco"
            else parse_lcov(text, repository, source.prefix)
        )

        if part is not None:
            parts.append(part)

    return parts


def read_source(
    repository: Path, source: Source, files: list[str], since: float | None = None
) -> Coverage | None:
    parts = parse_matches(repository, source, files, since)

    if parts is None:
        return None

    merged: Coverage = {}

    for part in parts:
        merge_coverage(merged, part)

    return merged


def has_well_formed_report(
    repository: Path, source: Source, files: list[str], since: float | None = None
) -> bool:
    return bool(parse_matches(repository, source, files, since))
