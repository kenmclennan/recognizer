import sys
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path

from coverage import CoverageData
from coverage.exceptions import CoverageException

from recognizer_sensors.crap.lcov import normalise_path
from recognizer_sensors.testrun.profiles import PYTHON_DATA

Lines = dict[int, frozenset[str]]


class PythonContexts:
    def __init__(self, repository: Path, usable: Callable[[object, Path], frozenset[str] | None]):
        self.repository = repository
        self.usable = usable
        self.data: CoverageData | None = None
        self.raw: dict[str, str] = {}
        self.cached: tuple[str, Lines] | None = None
        self.names: frozenset[str] | None = None
        self.open()

    def open(self) -> None:
        data = CoverageData(basename=str(self.repository / PYTHON_DATA))

        try:
            data.read()
            measured = list(data.measured_files())
        except CoverageException:
            print(
                "recognizer-sensors: mutation: the coverage data could not be read,"
                " so the whole suite runs",
                file=sys.stderr,
            )

            return

        self.data = data

        for raw in measured:
            path = normalise_path(raw, self.repository)

            if path is not None:
                self.raw[path] = raw

    def read(self, raw: str) -> Lines:
        assert self.data is not None
        shared: dict[frozenset[str], frozenset[str]] = {}
        lines: Lines = {}

        for number, names in self.data.contexts_by_lineno(raw).items():
            tests = self.usable(names, self.repository)

            if tests:
                lines[number] = shared.setdefault(tests, tests)

        return lines

    def lines(self, path: str) -> Lines:
        raw = self.raw.get(path)

        if raw is None:
            return {}

        if self.cached is not None and self.cached[0] == path:
            return self.cached[1]

        lines = self.read(raw)
        self.cached = (path, lines)

        return lines

    @property
    def paths(self) -> list[str]:
        return list(self.raw)

    @property
    def suite_files(self) -> frozenset[str]:
        if self.names is None:
            found: set[str] = set()

            for raw in self.raw.values():
                lines = self.read(raw)

                for tests in lines.values():
                    found.update(tests)

                del lines

            self.names = frozenset(found)

        return self.names


class ContextSelection(Mapping):
    def __init__(self, eager: dict[str, Lines], python: PythonContexts):
        self.eager = eager
        self.python = python

    def __getitem__(self, path: str) -> Lines:
        if path in self.eager:
            return self.eager[path]

        if path in self.python.raw:
            return self.python.lines(path)

        raise KeyError(path)

    def get(self, path, default=None):
        if path in self.eager:
            return self.eager[path]

        if path in self.python.raw:
            return self.python.lines(path)

        return default

    def __iter__(self) -> Iterator[str]:
        yield from self.eager

        for path in self.python.paths:
            if path not in self.eager:
                yield path

    def __len__(self) -> int:
        return len(set(self.eager) | set(self.python.raw))

    @property
    def suite_size(self) -> int:
        names = {f for lines in self.eager.values() for files in lines.values() for f in files}

        return len(names | self.python.suite_files)
