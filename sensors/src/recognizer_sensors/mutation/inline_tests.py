import hashlib
import re
import sys
from collections.abc import Mapping
from pathlib import Path, PurePosixPath

from tree_sitter import Node

from recognizer_sensors.hashes import digest_of, file_sha256, listed_files
from recognizer_sensors.parsing import parse

TEST_ATTRIBUTE = re.compile(r"^#\[\s*test\s*\]$")

CFG_ATTRIBUTE = re.compile(r"^#\[\s*cfg\s*\((.*)\)\s*\]$", re.DOTALL)

PATH_ATTRIBUTE = re.compile(r"^#\[\s*path\b")

ROOT_STEMS = {"lib", "main", "mod"}


class UnsoundWalk(Exception):
    pass


def is_test_attribute(text: str) -> bool:
    if TEST_ATTRIBUTE.match(text):
        return True

    cfg = CFG_ATTRIBUTE.match(text)

    if cfg is None:
        return False

    words = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", cfg.group(1))

    return "test" in words and "not" not in words


def items_with_attributes(parent: Node) -> list[tuple[list[Node], Node]]:
    found: list[tuple[list[Node], Node]] = []
    pending: list[Node] = []

    for child in parent.children:
        if child.type == "attribute_item":
            pending.append(child)
        elif child.is_named and child.type not in ("line_comment", "block_comment"):
            found.append((pending, child))
            pending = []

    return found


def attribute_texts(attributes: list[Node]) -> list[str]:
    return [(a.text or b"").decode("utf-8", errors="replace") for a in attributes]


def module_directory(file: PurePosixPath) -> PurePosixPath:
    if file.stem in ROOT_STEMS:
        return file.parent

    return file.parent / file.stem


def module_name(node: Node) -> str:
    name = node.child_by_field_name("name")

    return (name.text or b"").decode("utf-8") if name is not None else ""


def read(repository: Path, file: PurePosixPath) -> bytes:
    try:
        return (repository / file).read_bytes()
    except OSError as error:
        raise UnsoundWalk(f"cannot read {file}") from error


def resolve(repository: Path, directory: PurePosixPath, name: str) -> PurePosixPath:
    for candidate in (directory / f"{name}.rs", directory / name / "mod.rs"):
        if (repository / candidate).is_file():
            return candidate

    raise UnsoundWalk(f"mod {name} resolves to no file")


def walk_file(
    repository: Path,
    file: PurePosixPath,
    seen: set[PurePosixPath],
    entries: dict[str, str],
) -> None:
    if file in seen:
        return

    seen.add(file)
    source = read(repository, file)
    walk_items(
        repository,
        file,
        parse("rust", source).root_node,
        module_directory(file),
        source,
        seen,
        entries,
    )


def walk_items(
    repository: Path,
    file: PurePosixPath,
    parent: Node,
    directory: PurePosixPath,
    source: bytes,
    seen: set[PurePosixPath],
    entries: dict[str, str],
) -> None:
    for attributes, item in items_with_attributes(parent):
        texts = attribute_texts(attributes)
        is_test = any(is_test_attribute(t) for t in texts)

        if item.type == "mod_item":
            if any(PATH_ATTRIBUTE.match(t) for t in texts):
                raise UnsoundWalk(f"#[path] on mod {module_name(item)}")

            body = item.child_by_field_name("body")

            if body is None:
                module = resolve(repository, directory, module_name(item))

                if is_test:
                    entries[f"{module}#file"] = hashlib.sha256(read(repository, module)).hexdigest()
                else:
                    walk_file(repository, module, seen, entries)

                continue

            if not is_test:
                walk_items(
                    repository, file, body, directory / module_name(item), source, seen, entries
                )

                continue

        if is_test:
            start = attributes[0].start_byte if attributes else item.start_byte
            entries[f"{file}#{len(entries)}"] = hashlib.sha256(
                source[start : item.end_byte]
            ).hexdigest()


def coarse_digest(repository: Path, root: PurePosixPath) -> str:
    prefix = "" if str(root.parent) == "." else f"{root.parent}/"
    hashes: dict[str, str] = {}

    for path in listed_files(repository):
        if path.endswith(".rs") and path.startswith(prefix):
            hashes[path] = file_sha256(repository / path) or ""

    return digest_of(hashes)


def unit_digest(repository: Path, root: str) -> str:
    entries: dict[str, str] = {}

    try:
        walk_file(repository, PurePosixPath(root), set(), entries)
    except UnsoundWalk as error:
        print(
            f"recognizer-sensors: mutation: in-file tests of {root} not found by module walk "
            f"({error}); any edit to its source reruns the sites it covers",
            file=sys.stderr,
        )

        return coarse_digest(repository, PurePosixPath(root))

    return digest_of(entries)


def unit_test_hashes(repository: Path, units: Mapping[str, tuple[str, str, str]]) -> dict[str, str]:
    return {
        root: unit_digest(repository, root)
        for root, (_package, kind, _name) in sorted(units.items())
        if kind in ("lib", "bin")
    }
