from pathlib import Path, PurePosixPath

Coverage = dict[str, dict[int, int]]


def normalise_path(raw: str, repository: Path) -> str | None:
    if raw.startswith("./"):
        raw = raw[2:]

    if not raw.startswith("/"):
        return raw

    try:
        return PurePosixPath(raw).relative_to(repository.resolve().as_posix()).as_posix()
    except ValueError:
        return None


def parse_da(payload: str) -> tuple[int, int] | None:
    parts = payload.split(",")

    if len(parts) < 2:
        return None

    line, hits = parts[0].strip(), parts[1].strip()

    if not (line.isascii() and line.isdigit() and hits.isascii() and hits.isdigit()):
        return None

    return int(line), int(hits)


def parse_lcov(text: str, repository: Path) -> Coverage:
    coverage: Coverage = {}
    current: dict[int, int] | None = None

    for raw in text.splitlines():
        line = raw.strip()

        if line.startswith("SF:"):
            path = normalise_path(line[3:].strip(), repository)
            current = coverage.setdefault(path, {}) if path is not None else {}
        elif line == "end_of_record":
            current = None
        elif line.startswith("DA:") and current is not None:
            parsed = parse_da(line[3:])

            if parsed is not None:
                number, hits = parsed
                current[number] = current.get(number, 0) + hits

    return coverage


def read_lcov(path: Path, repository: Path) -> Coverage | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return None

    return parse_lcov(text, repository)


def function_coverage(lines: dict[int, int] | None, start_line: int, end_line: int) -> float | None:
    if lines is None:
        return None

    in_range = [hits for number, hits in lines.items() if start_line <= number <= end_line]

    if not in_range:
        return None

    return sum(1 for hits in in_range if hits > 0) / len(in_range)
