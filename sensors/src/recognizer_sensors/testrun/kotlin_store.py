import hashlib
import json
import shutil
from collections.abc import Iterator, Mapping
from pathlib import Path

LISTENER_RESOURCES = Path(__file__).parent / "listener"

LISTENER_FILES = ("RecognizerListener.java", "recognizer-coverage.init.gradle")

LISTENER_DIRECTORY = ".recognizer/cache/gradle"

DUMPS_DIRECTORY = ".recognizer/cache/coverage/kotlin/dumps"

STORE_DIRECTORY = ".recognizer/cache/coverage/kotlin/selection"

HEADER = "tests.json"

ROOT_PROJECT_DIRECTORY = "~"

Lines = dict[int, frozenset[str]]


def prepare_listener(repository: Path) -> list[str] | None:
    target = repository / LISTENER_DIRECTORY
    dumps = repository / DUMPS_DIRECTORY

    try:
        target.mkdir(parents=True, exist_ok=True)

        for name in LISTENER_FILES:
            shutil.copyfile(LISTENER_RESOURCES / name, target / name)

        shutil.rmtree(dumps, ignore_errors=True)
        dumps.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None

    return [
        "--init-script",
        str(target / LISTENER_FILES[1]),
        f"-Drecognizer.listener={target}",
        f"-Drecognizer.dumps={dumps}",
    ]


def project_of_directory(name: str) -> str:
    return "" if name == ROOT_PROJECT_DIRECTORY else name.replace("~", ":")


def parse_lines(text: str, files: list[str]) -> dict[str, list[int]]:
    covered: dict[str, list[int]] = {}

    for row in text.splitlines():
        suffix, _, numbers = row.partition("\t")
        matches = [f for f in files if f == suffix or f.endswith("/" + suffix)]

        if len(matches) != 1:
            continue

        found = covered.setdefault(matches[0], [])

        for number in numbers.split(","):
            if number.isdigit():
                found.append(int(number))

    return covered


def dumped_classes(repository: Path) -> dict[tuple[str, str], Path]:
    found: dict[tuple[str, str], Path] = {}
    root = repository / DUMPS_DIRECTORY

    for folder in sorted(p for p in root.glob("*") if p.is_dir()):
        for lines in sorted(folder.glob("*.lines")):
            found[(project_of_directory(folder.name), lines.name[: -len(".lines")])] = lines

    return found


def record_name(path: str) -> str:
    return hashlib.sha256(path.encode("utf-8")).hexdigest()[:32] + ".json"


def write_store(repository: Path, executed: dict[str, dict[int, set[str]]]) -> "KotlinStore":
    folder = repository / STORE_DIRECTORY
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True, exist_ok=True)
    tests = sorted(
        {name for lines in executed.values() for names in lines.values() for name in names}
    )
    index = {name: number for number, name in enumerate(tests)}
    paths = sorted(executed)

    for path in paths:
        sets: list[list[int]] = []
        known: dict[tuple[int, ...], int] = {}
        lines: dict[str, int] = {}

        for line, names in sorted(executed[path].items()):
            key = tuple(sorted(index[name] for name in names))

            if key not in known:
                known[key] = len(sets)
                sets.append(list(key))

            lines[str(line)] = known[key]

        record = {"path": path, "sets": sets, "lines": lines}
        (folder / record_name(path)).write_text(json.dumps(record), encoding="utf-8")

    (folder / HEADER).write_text(json.dumps({"tests": tests, "paths": paths}), encoding="utf-8")

    return KotlinStore(repository)


class KotlinStore(Mapping):
    def __init__(self, repository: Path):
        self.folder = repository / STORE_DIRECTORY
        header = json.loads((self.folder / HEADER).read_text(encoding="utf-8"))
        self.tests: list[str] = header["tests"]
        self.known: frozenset[str] = frozenset(header["paths"])
        self.cached: tuple[str, Lines] | None = None
        self.reads = 0

    def __getitem__(self, path: str) -> Lines:
        if path not in self.known:
            raise KeyError(path)

        if self.cached is not None and self.cached[0] == path:
            return self.cached[1]

        self.reads += 1
        record = json.loads((self.folder / record_name(path)).read_text(encoding="utf-8"))
        sets = [frozenset(self.tests[number] for number in numbers) for numbers in record["sets"]]
        lines = {int(line): sets[number] for line, number in record["lines"].items()}
        self.cached = (path, lines)

        return lines

    def __iter__(self) -> Iterator[str]:
        return iter(sorted(self.known))

    def __len__(self) -> int:
        return len(self.known)

    @property
    def suite_files(self) -> frozenset[str]:
        return frozenset(self.tests)
