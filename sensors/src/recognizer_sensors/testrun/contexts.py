import sys
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path

from coverage import CoverageData
from coverage.exceptions import CoverageException

from recognizer_sensors.crap.lcov import normalise_path
from recognizer_sensors.hashes import listed_files

PYTHON_DATA = ".recognizer/cache/coverage/python.data"

Lines = dict[int, frozenset[str]]


def usable_contexts(names: object, directory: Path) -> frozenset[str] | None:
    if not isinstance(names, list | set | tuple | frozenset):
        return None

    files: set[str] = set()

    for name in names:
        if not isinstance(name, str) or name == "":
            continue

        path = name.split("|", 1)[0].split("::", 1)[0]

        if not path or not (directory / path).is_file():
            return None

        files.add(path)

    return frozenset(files) if files else None


def path_like(name: str) -> bool:
    return any(mark in name for mark in ("/", "::", "|")) or name.endswith(".py")


def dotted_file(name: str, directory: Path, listed: list[str], prefix: str) -> str | None:
    parts = name.split(".")

    for size in range(len(parts), 0, -1):
        relative = "/".join(parts[:size]) + ".py"

        if (directory / relative).is_file():
            return relative

        matches = [
            path
            for path in listed
            if path.endswith(".py") and (path == relative or path.endswith("/" + relative))
        ]

        if len(matches) == 1:
            return matches[0].removeprefix(prefix) if prefix else matches[0]

        if matches:
            return None

    return None


def dynamic_contexts(
    names: object, directory: Path, listed: list[str], prefix: str
) -> frozenset[str] | None:
    if not isinstance(names, list | set | tuple | frozenset):
        return None

    files: set[str] = set()

    for name in names:
        if not isinstance(name, str) or name == "":
            return None

        found = dotted_file(name, directory, listed, prefix)

        if found is None:
            return None

        files.add(found)

    return frozenset(files) if files else None


class PythonContexts:
    def __init__(
        self,
        repository: Path,
        usable: Callable[[object, Path], frozenset[str] | None] = usable_contexts,
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
        self.recorded = True
        self.contexts: list[str] = []
        self.dynamic = False
        self.listed: list[str] | None = None
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

        try:
            contexts = [name for name in data.measured_contexts() if name != ""]
        except CoverageException:
            contexts = []

        self.contexts = sorted(contexts)

        if measured:
            self.recorded = bool(contexts)

        self.dynamic = bool(contexts) and not any(path_like(name) for name in contexts)

        for raw in measured:
            path = normalise_path(raw, self.repository)

            if path is not None:
                self.raw[path] = raw

    def read(self, raw: str) -> Lines:
        assert self.data is not None
        shared: dict[frozenset[str], frozenset[str]] = {}
        lines: Lines = {}

        for number, names in self.data.contexts_by_lineno(raw).items():
            if self.dynamic:
                tests = self.dotted(names)
            else:
                tests = self.usable(names, self.repository / self.directory)

            if tests and self.directory:
                tests = frozenset(f"{self.directory}/{name}" for name in tests)

            if tests:
                lines[number] = shared.setdefault(tests, tests)

        return lines

    def dotted(self, names: object) -> frozenset[str] | None:
        if self.listed is None:
            self.listed = listed_files(self.repository) or [
                path.relative_to(self.repository).as_posix()
                for path in self.repository.rglob("*.py")
                if path.is_file()
            ]

        prefix = f"{self.directory}/" if self.directory else ""
        scoped = [path for path in self.listed if path.startswith(prefix)]

        return dynamic_contexts(names, self.repository / self.directory, scoped, prefix)

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
    def unresolved(self) -> str | None:
        if not self.recorded or not self.raw or not self.contexts or self.suite_files:
            return None

        return self.contexts[0]

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
    def __init__(self, eager: dict[str, Lines], python: "PythonContexts | list[PythonContexts]"):
        self.eager = eager
        self.readers = python if isinstance(python, list) else [python]

    @property
    def python(self) -> PythonContexts:
        return self.readers[0]

    def reader_of(self, path: str) -> "PythonContexts | None":
        return next((reader for reader in self.readers if path in reader.raw), None)

    def __getitem__(self, path: str) -> Lines:
        if path in self.eager:
            return self.eager[path]

        reader = self.reader_of(path)

        if reader is not None:
            return reader.lines(path)

        raise KeyError(path)

    def get(self, path, default=None):
        if path in self.eager:
            return self.eager[path]

        reader = self.reader_of(path)

        if reader is not None:
            return reader.lines(path)

        return default

    def __iter__(self) -> Iterator[str]:
        yield from self.eager

        for reader in self.readers:
            for path in reader.paths:
                if path not in self.eager:
                    yield path

    def __len__(self) -> int:
        return len(set(self.eager) | {path for reader in self.readers for path in reader.raw})

    @property
    def suite_size(self) -> int:
        names = {f for lines in self.eager.values() for files in lines.values() for f in files}

        return len(names.union(*(reader.suite_files for reader in self.readers)))
