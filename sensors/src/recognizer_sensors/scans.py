import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from recognizer_sensors.parsing import LANGUAGES


@dataclass(frozen=True)
class ScanModule:
    id: str
    files: tuple[str, ...]


@dataclass(frozen=True)
class Scan:
    language: str
    modules: tuple[ScanModule, ...]
    modified: bool


def scan_path(repository: Path, language: str) -> Path:
    return repository / ".recognizer" / "cache" / f"scan.{language}.json"


def module_files(language: str, module_id: str, files: list[str]) -> tuple[str, ...]:
    if language == "kotlin":
        return tuple(sorted(f for f in files if PurePosixPath(f).parent.as_posix() == module_id))

    return (module_id,) if module_id in files else ()


def read_scan(repository: Path, language: str) -> Scan | None:
    try:
        document = json.loads(scan_path(repository, language).read_text(encoding="utf-8"))
        files = [entry["path"] for entry in document["files"]]
        module_ids = [entry["id"] for entry in document["modules"]]
        modified = document.get("modified") is not False
    except (OSError, ValueError, KeyError, TypeError):
        return None

    if not all(isinstance(f, str) for f in files) or not all(
        isinstance(m, str) for m in module_ids
    ):
        return None

    modules = tuple(ScanModule(m, module_files(language, m, files)) for m in module_ids)

    return Scan(language, modules, modified)


def read_scans(repository: Path) -> list[Scan]:
    scans = (read_scan(repository, language) for language in LANGUAGES)

    return [scan for scan in scans if scan is not None]
