import configparser
import tomllib
from pathlib import Path, PurePosixPath

ROOT = "."


def as_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]

    if isinstance(value, dict):
        return [key for key in value if isinstance(key, str)]

    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]

    return []


def package_dir_roots(mapping: dict[str, str]) -> list[str]:
    roots = []

    for key, value in mapping.items():
        if key == "":
            roots.append(value)
            continue

        suffix = "/".join(key.split("."))

        if value == suffix:
            continue

        if value.endswith("/" + suffix):
            roots.append(value[: -len(suffix) - 1])

    return roots


def string_table(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}

    return {k: v for k, v in value.items() if isinstance(k, str) and isinstance(v, str)}


def table(document: dict, *path: str) -> dict:
    current: object = document

    for key in path:
        if not isinstance(current, dict):
            return {}

        current = current.get(key)

    return current if isinstance(current, dict) else {}


def from_pyproject(root: Path) -> list[str]:
    try:
        document = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    setuptools = table(document, "tool", "setuptools")
    wheel = table(document, "tool", "hatch", "build", "targets", "wheel")
    found = package_dir_roots(string_table(setuptools.get("package-dir")))
    found += as_list(table(setuptools, "packages", "find").get("where"))

    for entry in as_list(wheel.get("packages")):
        parent = PurePosixPath(entry).parent.as_posix()

        if parent != ROOT:
            found.append(parent)

    found += as_list(wheel.get("sources"))

    return found


def from_setup_cfg(root: Path) -> list[str]:
    parser = configparser.ConfigParser(interpolation=None)

    try:
        parser.read(root / "setup.cfg", encoding="utf-8")
    except (OSError, configparser.Error, UnicodeDecodeError):
        return []

    found = []
    package_dir = parser.get("options", "package_dir", fallback="")
    mapping = {}

    for line in package_dir.replace(",", "\n").splitlines():
        key, separator, value = line.partition("=")

        if separator:
            mapping[key.strip()] = value.strip()

    found += package_dir_roots(mapping)
    where = parser.get("options.packages.find", "where", fallback="")
    found += [item.strip() for item in where.replace(",", "\n").splitlines() if item.strip()]

    return found


def from_layout(module_ids: list[str]) -> list[str]:
    found = set()

    for module_id in module_ids:
        path = PurePosixPath(module_id)

        if path.name == "__init__.py" and len(path.parts) >= 3 and path.parts[-3] == "src":
            found.add(path.parents[1].as_posix())

    return sorted(found)


def usable(root: Path, candidate: str) -> str | None:
    path = PurePosixPath(candidate.strip())

    if path.is_absolute() or ".." in path.parts or not (root / path).is_dir():
        return None

    return path.as_posix()


def detect_source_roots(root: Path, module_ids: list[str]) -> list[str]:
    declared = from_pyproject(root) + from_setup_cfg(root) + from_layout(module_ids)
    roots: list[str] = []

    for candidate in declared:
        kept = usable(root, candidate)

        if kept is not None and kept != ROOT and kept not in roots:
            roots.append(kept)

    return roots + [ROOT]
