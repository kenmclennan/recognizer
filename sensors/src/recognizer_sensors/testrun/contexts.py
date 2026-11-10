import sys
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path

from coverage import CoverageData
from coverage.exceptions import CoverageException

from recognizer_sensors.crap.lcov import normalise_path
from recognizer_sensors.testrun.profiles import PYTHON_DATA

Lines = dict[int, frozenset[str]]


class PythonContexts:
    def __init__(
        self,
        repository: Path,
        usable: Callable[[object, Path], frozenset[str] | None],
        directory: str = "",
        data: str = PYTHON_DATA,
    ):
        self.repository = repository
        self.directory = directory
        self.data_path = data
        self.usable = usable
        self.data: CoverageData | None = None
        self.raw: dict[str, str] = {}
        self.cached: tuple[str, Lines] | None = None
        self.names: frozenset[str] | None = None
        self.open()

    def open(self) -> None:
        data = CoverageData(basename=str(self.repository / self.data_path))

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
            tests = self.usable(names, self.repository / self.directory)

            if tests and self.directory:
                tests = frozenset(f"{self.directory}/{name}" for name in tests)

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
    def __init__(
        self,
        eager: dict[str, Lines],
        python: "PythonContexts | list[PythonContexts] | None" = None,
        stores: Sequence[Mapping] = (),
    ):
        self.eager = eager
        self.readers = python if isinstance(python, list) else ([] if python is None else [python])
        self.stores = list(stores)

    @property
    def python(self) -> "PythonContexts | None":
        return self.readers[0] if self.readers else None

    def reader_of(self, path: str) -> "PythonContexts | None":
        return next((reader for reader in self.readers if path in reader.raw), None)

    def get(self, path, default=None):
        if path in self.eager:
            return self.eager[path]

        for store in self.stores:
            if path in store:
                return store[path]

        reader = self.reader_of(path)

        if reader is not None:
            return reader.lines(path)

        return default

    def __getitem__(self, path: str) -> Lines:
        found = self.get(path)

        if found is None:
            raise KeyError(path)

        return found

    def paths(self) -> list[str]:
        seen = dict.fromkeys(self.eager)

        for store in self.stores:
            seen.update(dict.fromkeys(store))

        for reader in self.readers:
            seen.update(dict.fromkeys(reader.paths))

        return list(seen)

    def __iter__(self) -> Iterator[str]:
        return iter(self.paths())

    def __len__(self) -> int:
        return len(self.paths())

    @property
    def suite_size(self) -> int:
        names = {f for lines in self.eager.values() for files in lines.values() for f in files}

        for store in self.stores:
            names |= store.suite_files

        for reader in self.readers:
            names |= reader.suite_files

        return len(names)
