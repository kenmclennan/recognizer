import hashlib
import sys
from collections.abc import Mapping
from pathlib import Path, PurePosixPath

from tree_sitter import Node

from recognizer_sensors.hashes import digest_of, file_sha256, listed_files
from recognizer_sensors.parsing import parse
from recognizer_sensors.rust_test_blocks import (
    Declaration,
    is_root_file,
    is_test_attribute_text,
    path_value,
    resolved_declaration,
)


class UnsoundWalk(Exception):
    pass


def is_test_attribute(text: str) -> bool:
    if not (text.startswith("#[") and text.endswith("]")):
        return False

    return is_test_attribute_text(text[2:-1])


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


def module_name(node: Node) -> str:
    name = node.child_by_field_name("name")

    return (name.text or b"").decode("utf-8") if name is not None else ""


def read(repository: Path, file: str) -> bytes:
    try:
        return (repository / file).read_bytes()
    except OSError as error:
        raise UnsoundWalk(f"cannot read {file}") from error


def resolve(
    repository: Path,
    file: str,
    scope: tuple[str, ...],
    name: str,
    path: str | None,
    is_root: bool | None = None,
) -> str:
    found = resolved_declaration(
        file,
        Declaration(scope, name, path, False),
        lambda candidate: (repository / candidate).is_file(),
        is_root,
    )

    if found is None:
        raise UnsoundWalk(f"mod {name} resolves to no file")

    return found


def path_of(texts: list[str]) -> str | None:
    for text in texts:
        if text.startswith("#[") and text.endswith("]"):
            found = path_value(text[2:-1].encode("utf-8"))

            if found is not None:
                return found

    return None


def has_inner_test_attribute(root: Node) -> bool:
    for child in root.children:
        text = (child.text or b"").decode("utf-8", errors="replace")

        if child.type == "inner_attribute_item" and text.startswith("#![") and text.endswith("]"):
            if is_test_attribute_text(text[3:-1]):
                return True

    return False


def record_test_file(repository: Path, file: str, entries: dict[str, str]) -> bool:
    key = f"{file}#file"

    if key in entries:
        return False

    entries[key] = hashlib.sha256(read(repository, file)).hexdigest()

    return True


def walk_test_file(repository: Path, file: str, entries: dict[str, str]) -> None:
    if not record_test_file(repository, file, entries):
        return

    root = parse("rust", read(repository, file)).root_node

    for scope, name, path in declarations_of(root, ()):
        walk_test_file(repository, resolve(repository, file, scope, name, path), entries)


def declarations_of(
    parent: Node, scope: tuple[str, ...]
) -> list[tuple[tuple[str, ...], str, str | None]]:
    found: list[tuple[tuple[str, ...], str, str | None]] = []

    for attributes, item in items_with_attributes(parent):
        if item.type != "mod_item":
            continue

        body = item.child_by_field_name("body")
        name = module_name(item)

        if body is None:
            found.append((scope, name, path_of(attribute_texts(attributes))))
        else:
            found.extend(declarations_of(body, (*scope, name)))

    return found


def walk_file(
    repository: Path,
    file: PurePosixPath,
    seen: set[PurePosixPath],
    entries: dict[str, str],
    *,
    is_root: bool | None = None,
) -> None:
    if file in seen:
        return

    seen.add(file)
    source = read(repository, str(file))
    root = parse("rust", source).root_node

    if has_inner_test_attribute(root):
        walk_test_file(repository, str(file), entries)

        return

    walk_items(
        repository,
        file,
        root,
        (),
        source,
        seen,
        entries,
        is_root=is_root_file(str(file)) if is_root is None else is_root,
    )


def walk_items(
    repository: Path,
    file: PurePosixPath,
    parent: Node,
    scope: tuple[str, ...],
    source: bytes,
    seen: set[PurePosixPath],
    entries: dict[str, str],
    *,
    is_root: bool,
) -> None:
    for attributes, item in items_with_attributes(parent):
        texts = attribute_texts(attributes)
        is_test = any(is_test_attribute(t) for t in texts)

        if item.type == "mod_item":
            body = item.child_by_field_name("body")
            name = module_name(item)

            if body is None:
                module = resolve(repository, str(file), scope, name, path_of(texts), is_root)

                if is_test:
                    walk_test_file(repository, module, entries)
                else:
                    walk_file(repository, PurePosixPath(module), seen, entries)

                continue

            if not is_test:
                walk_items(
                    repository, file, body, (*scope, name), source, seen, entries, is_root=is_root
                )

                continue

        if is_test:
            start = attributes[0].start_byte if attributes else item.start_byte
            entries[f"{file}#{len(entries)}"] = hashlib.sha256(
                source[start : item.end_byte]
            ).hexdigest()


def walk_undeclared_test_files(
    repository: Path, root: PurePosixPath, entries: dict[str, str]
) -> None:
    prefix = "" if str(root.parent) == "." else f"{root.parent}/"

    for path in listed_files(repository):
        if not (path.endswith(".rs") and path.startswith(prefix)):
            continue

        if f"{path}#file" in entries:
            continue

        source = read(repository, path)

        if b"#![" in source and has_inner_test_attribute(parse("rust", source).root_node):
            walk_test_file(repository, path, entries)


def walk_unit(repository: Path, root: PurePosixPath, entries: dict[str, str]) -> None:
    walk_file(repository, root, set(), entries, is_root=True)
    walk_undeclared_test_files(repository, root, entries)


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
        walk_unit(repository, PurePosixPath(root), entries)
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
