import hashlib
import posixpath
import re
import tomllib
from collections.abc import Callable, Collection
from pathlib import Path, PurePosixPath
from typing import NamedTuple

from recognizer_sensors.mutation.test_files import is_test_file

WHITESPACE = b" \t\n\r\x0b\x0c"

WORD = re.compile(rb"[A-Za-z_][A-Za-z0-9_]*")

ROOT_NAMES = {"lib.rs", "main.rs", "build.rs"}

PATH_VALUE = re.compile(r'^\s*path\s*=\s*"((?:[^"\\]|\\.)*)"\s*$', re.DOTALL)


class Declaration(NamedTuple):
    scope: tuple[str, ...]
    name: str
    path: str | None
    is_test: bool


class Scan(NamedTuple):
    items: list[tuple[int, int]]
    file_level: bool
    declarations: list[Declaration]


def is_identifier_byte(byte: int) -> bool:
    return byte == 0x5F or 0x30 <= byte <= 0x39 or 0x41 <= byte <= 0x5A or 0x61 <= byte <= 0x7A


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def skip_block_comment(data: bytes, start: int) -> int:
    depth = 0
    i = start

    while i < len(data):
        if data.startswith(b"/*", i):
            depth += 1
            i += 2
        elif data.startswith(b"*/", i):
            depth -= 1
            i += 2

            if depth == 0:
                return i
        else:
            i += 1

    return len(data)


def skip_quoted(data: bytes, start: int) -> int:
    i = start + 1

    while i < len(data):
        if data[i] == 0x5C:
            i += 2
        elif data[i] == 0x22:
            return i + 1
        else:
            i += 1

    return len(data)


def skip_raw(data: bytes, start: int, hashes: int) -> int:
    closing = b'"' + b"#" * hashes
    end = data.find(closing, start)

    return len(data) if end < 0 else end + len(closing)


def skip_character(data: bytes, start: int) -> int:
    i = start + 1

    if i >= len(data):
        return len(data)

    if data[i] == 0x5C:
        end = data.find(b"'", i + 2)

        return len(data) if end < 0 else end + 1

    lead = data[i]
    width = 1 if lead < 0xC0 else 2 if lead < 0xE0 else 3 if lead < 0xF0 else 4

    if i + width < len(data) and data[i + width] == 0x27:
        return i + width + 1

    return start + 1


def raw_start(data: bytes, start: int) -> int | None:
    i = start + 1
    hashes = 0

    while i < len(data) and data[i] == 0x23:
        hashes += 1
        i += 1

    if i < len(data) and data[i] == 0x22:
        return skip_raw(data, i + 1, hashes)

    return None


def skip_literal(data: bytes, i: int) -> int | None:
    byte = data[i]

    if byte == 0x2F and data.startswith(b"//", i):
        end = data.find(b"\n", i)

        return len(data) if end < 0 else end

    if byte == 0x2F and data.startswith(b"/*", i):
        return skip_block_comment(data, i)

    if byte == 0x22:
        return skip_quoted(data, i)

    if byte == 0x27:
        return skip_character(data, i)

    if byte in (0x72, 0x62) and (i == 0 or not is_identifier_byte(data[i - 1])):
        prefix = i + 1

        if byte == 0x62 and prefix < len(data):
            if data[prefix] == 0x22:
                return skip_quoted(data, prefix)

            if data[prefix] == 0x27:
                return skip_character(data, prefix)

            if data[prefix] == 0x72:
                return raw_start(data, prefix)

        if byte == 0x72:
            return raw_start(data, i)

    return None


def skip_trivia(data: bytes, start: int) -> int:
    i = start

    while i < len(data):
        if data[i] in WHITESPACE:
            i += 1
        elif data.startswith(b"//", i) or data.startswith(b"/*", i):
            i = skip_literal(data, i) or i + 1
        else:
            break

    return i


def attribute_end(data: bytes, start: int) -> int:
    depth = 1
    i = start

    while i < len(data):
        skipped = skip_literal(data, i)

        if skipped is not None:
            i = skipped
            continue

        if data[i] == 0x5B:
            depth += 1
        elif data[i] == 0x5D:
            depth -= 1

            if depth == 0:
                return i + 1

        i += 1

    return len(data)


def gate_tokens(text: str) -> list[str] | None:
    tokens: list[str] = []
    i = 0

    while i < len(text):
        c = text[i]

        if c in " \t\n\r\x0b\x0c":
            i += 1
        elif c in "(),=":
            tokens.append(c)
            i += 1
        elif c == "_" or ("A" <= c <= "Z") or ("a" <= c <= "z"):
            j = i

            while j < len(text) and (text[j] == "_" or text[j].isascii() and text[j].isalnum()):
                j += 1

            tokens.append(text[i:j])
            i = j
        elif c == '"':
            j = i + 1

            while j < len(text) and text[j] != '"':
                j += 2 if text[j] == "\\" else 1

            if j >= len(text):
                return None

            tokens.append('"')
            i = j + 1
        else:
            return None

    return tokens


def gate_predicate(tokens: list[str], at: int) -> tuple[int, bool] | None:
    if at >= len(tokens):
        return None

    name = tokens[at]

    if not (name[0] == "_" or name[0].isascii() and name[0].isalpha()):
        return None

    after = tokens[at + 1] if at + 1 < len(tokens) else None

    if after == "=":
        if at + 2 < len(tokens) and tokens[at + 2] == '"':
            return at + 3, False

        return None

    if after != "(":
        return at + 1, name == "test"

    results: list[bool] = []
    i = at + 2

    while i < len(tokens) and tokens[i] != ")":
        item = gate_predicate(tokens, i)

        if item is None:
            return None

        i, requires_test = item
        results.append(requires_test)

        if i < len(tokens) and tokens[i] == ",":
            i += 1
        elif i >= len(tokens) or tokens[i] != ")":
            return None

    if i >= len(tokens):
        return None

    if name == "all":
        return i + 1, any(results)

    if name == "any":
        return i + 1, bool(results) and all(results)

    return i + 1, False


def is_test_attribute_text(inner: str) -> bool:
    if "".join(ch for ch in inner if ch not in " \t\n\r\x0b\x0c") == "test":
        return True

    tokens = gate_tokens(inner)

    if tokens is None or tokens[:2] != ["cfg", "("]:
        return False

    predicate = gate_predicate(tokens, 2)

    if predicate is None:
        return False

    end, requires_test = predicate

    return requires_test and end == len(tokens) - 1 and tokens[end] == ")"


def is_test_attribute(inner: bytes) -> bool:
    return is_test_attribute_text(inner.decode("latin1"))


def attribute_inner(data: bytes, start: int, end: int, opener: int) -> bytes:
    return data[start + opener : end - 1]


def item_end(data: bytes, start: int) -> int:
    depth = 0
    first_brace: int | None = None
    i = start

    while i < len(data):
        skipped = skip_literal(data, i)

        if skipped is not None:
            i = skipped
            continue

        byte = data[i]

        if byte in (0x28, 0x5B, 0x7B):
            if byte == 0x7B and first_brace is None:
                first_brace = depth

            depth += 1
        elif byte in (0x29, 0x5D, 0x7D):
            if depth == 0:
                return i

            depth -= 1

            if byte == 0x7D and first_brace == depth:
                return i + 1
        elif byte == 0x3B and depth == 0:
            return i + 1

        i += 1

    return len(data)


def module_head(data: bytes, start: int) -> tuple[str, bool, int] | None:
    n = len(data)

    def skip_space(at: int) -> int:
        while at < n and data[at] in WHITESPACE:
            at += 1

        return at

    i = skip_space(start)

    if data.startswith(b"pub", i):
        after = i + 3

        if after < n and data[after] == 0x28:
            close = data.find(b")", after)

            if close < 0:
                return None

            i = skip_space(close + 1)
        elif after < n and data[after] in WHITESPACE:
            i = skip_space(after)
        else:
            return None

    if not data.startswith(b"mod", i):
        return None

    after = i + 3

    if after >= n or data[after] not in WHITESPACE:
        return None

    match = WORD.match(data, skip_space(after))

    if match is None:
        return None

    i = skip_space(match.end())

    if i < n and data[i] == 0x3B:
        return match.group().decode("ascii"), False, i + 1

    if i < n and data[i] == 0x7B:
        return match.group().decode("ascii"), True, i + 1

    return None


def path_value(inner: bytes) -> str | None:
    match = PATH_VALUE.match(inner.decode("latin1"))

    return match.group(1) if match else None


def scan(data: bytes) -> Scan:
    items: list[tuple[int, int]] = []
    declarations: list[Declaration] = []
    scope: list[tuple[str, int]] = []
    file_level = False
    depth = 0
    i = 0

    nesting = 0

    def enter(name: str, inline: bool, path: str | None, is_test: bool) -> None:
        nonlocal depth

        if inline:
            scope.append((name, depth))
            depth += 1
        elif depth == len(scope) and nesting == 0:
            declarations.append(
                Declaration(tuple(entry[0] for entry in scope), name, path, is_test)
            )

    while i < len(data):
        skipped = skip_literal(data, i)

        if skipped is not None:
            i = skipped
            continue

        if data.startswith(b"#![", i):
            end = attribute_end(data, i + 3)

            if depth == 0 and is_test_attribute(attribute_inner(data, i, end, 3)):
                file_level = True

            i = end
            continue

        if data.startswith(b"#[", i):
            start = i
            end = attribute_end(data, i + 2)
            inner = attribute_inner(data, i, end, 2)
            is_test = is_test_attribute(inner)
            path = path_value(inner)
            follow = skip_trivia(data, end)

            while data.startswith(b"#[", follow):
                end = attribute_end(data, follow + 2)
                inner = attribute_inner(data, follow, end, 2)
                is_test = is_test or is_test_attribute(inner)
                path = path or path_value(inner)
                follow = skip_trivia(data, end)

            if not is_test:
                head = module_head(data, end)

                if head is None:
                    i = end
                else:
                    enter(head[0], head[1], path, False)
                    i = head[2]

                continue

            stop = item_end(data, end)
            items.append((start, stop))
            head = module_head(data[end:stop], 0)

            if head is not None and not head[1]:
                enter(head[0], False, path, True)

            i = max(stop, end)
            continue

        byte = data[i]

        if byte == 0x7B:
            depth += 1
        elif byte == 0x7D:
            depth -= 1

            if scope and scope[-1][1] == depth:
                scope.pop()
        elif byte == 0x28 or byte == 0x5B:
            nesting += 1
        elif byte == 0x29 or byte == 0x5D:
            nesting = max(nesting - 1, 0)
        elif (byte == 0x6D or byte == 0x70) and (i == 0 or not is_identifier_byte(data[i - 1])):
            head = module_head(data, i)

            if head is not None:
                enter(head[0], head[1], None, False)
                i = head[2]
                continue

        i += 1

    return Scan(items, file_level, declarations)


def is_root_file(path: str) -> bool:
    file = PurePosixPath(path)
    parent = file.parent

    if file.name in ROOT_NAMES:
        return True

    if parent.name in ("examples", "benches"):
        return True

    return parent.name == "bin" and parent.parent.name == "src"


class Roots(NamedTuple):
    roots: frozenset[str]
    covered: frozenset[str]

    def is_root(self, path: str) -> bool:
        parent = PurePosixPath(path).parent

        for directory in (parent, *parent.parents):
            if ("" if str(directory) == "." else str(directory)) in self.covered:
                return path in self.roots

        return is_root_file(path)


def join_root(directory: str, relative: str) -> str | None:
    parts: list[str] = []

    for part in (f"{directory}/{relative}" if directory else relative).split("/"):
        if part in ("", "."):
            continue

        if part == "..":
            if not parts:
                return None

            parts.pop()
        else:
            parts.append(part)

    return "/".join(parts)


def manifest_roots(listed: Collection[str], read: Callable[[str], bytes | None]) -> Roots:
    paths = set(listed)
    sources = sorted(path for path in paths if path.endswith(".rs"))
    roots: set[str] = set()
    covered: set[str] = set()

    for manifest in sorted(path for path in paths if PurePosixPath(path).name == "Cargo.toml"):
        try:
            table = tomllib.loads((read(manifest) or b"").decode("utf-8"))
        except (UnicodeDecodeError, tomllib.TOMLDecodeError):
            continue

        package = table.get("package")

        if not isinstance(package, dict) or not isinstance(package.get("name"), str):
            continue

        parent = str(PurePosixPath(manifest).parent)
        directory = "" if parent == "." else parent
        covered.add(directory)

        def declare(relative: str, directory: str = directory) -> None:
            found = join_root(directory, relative)

            if found is not None and found in paths:
                roots.add(found)

        library = table.get("lib")
        library_path = library.get("path") if isinstance(library, dict) else None
        declare(library_path if isinstance(library_path, str) else "src/lib.rs")
        declare("src/main.rs")

        build = package.get("build")

        if build is not False:
            declare(build if isinstance(build, str) else "build.rs")

        for kind in ("bin", "example", "bench", "test"):
            entries = table.get(kind)

            for entry in entries if isinstance(entries, list) else []:
                if isinstance(entry, dict) and isinstance(entry.get("path"), str):
                    declare(entry["path"])

        for folder in ("src/bin", "examples", "benches"):
            prefix = f"{directory}/{folder}/" if directory else f"{folder}/"

            for path in sources:
                if not path.startswith(prefix):
                    continue

                rest = path[len(prefix) :]

                if "/" not in rest or (rest.count("/") == 1 and rest.endswith("/main.rs")):
                    roots.add(path)

    return Roots(frozenset(roots), frozenset(covered))


def module_candidates(
    file: str,
    scope: tuple[str, ...],
    name: str,
    path: str | None,
    is_root: bool | None = None,
) -> list[str]:
    posix = PurePosixPath(file)
    directory = "" if str(posix.parent) == "." else str(posix.parent)

    def join(base: str, tail: str) -> str | None:
        if tail.startswith("/"):
            return None

        joined = posixpath.normpath(f"{base}/{tail}" if base else tail)

        return None if joined.startswith("..") or joined == "." else joined

    if path is not None:
        found = join(directory, path)

        return [] if found is None else [found]

    root = is_root_file(file) if is_root is None else is_root
    base = directory if root or posix.name == "mod.rs" else join(directory, posix.stem) or ""

    for segment in scope:
        base = join(base, segment) or ""

    return [found for tail in (f"{name}.rs", f"{name}/mod.rs") if (found := join(base, tail))]


def resolved_declaration(
    file: str, declaration: Declaration, exists: Callable[[str], bool], is_root: bool | None = None
) -> str | None:
    for candidate in module_candidates(
        file, declaration.scope, declaration.name, declaration.path, is_root
    ):
        if exists(candidate):
            return candidate

    return None


def test_file_set(
    sources: Collection[str],
    first_pass: dict[str, Scan],
    scan_file: Callable[[str], Scan | None],
    is_root: Callable[[str], bool] | None = None,
) -> set[str]:
    index = set(sources)
    marked: set[str] = set()
    pending: list[str] = []

    def mark(path: str | None) -> None:
        if path is not None and path not in marked:
            marked.add(path)
            pending.append(path)

    for path, found in first_pass.items():
        if found.file_level:
            mark(path)

        for declaration in found.declarations:
            if declaration.is_test:
                mark(
                    resolved_declaration(
                        path,
                        declaration,
                        index.__contains__,
                        None if is_root is None else is_root(path),
                    )
                )

    while pending:
        file = pending.pop()
        found = first_pass.get(file) or scan_file(file)

        for declaration in found.declarations if found else []:
            mark(
                resolved_declaration(
                    file,
                    declaration,
                    index.__contains__,
                    None if is_root is None else is_root(file),
                )
            )

    return marked


def in_file_test_hashes(repository: Path, listed: Collection[str]) -> dict[str, str]:
    sources = sorted({path for path in listed if path.endswith(".rs")})
    entries: dict[str, str] = {}
    first_pass: dict[str, Scan] = {}

    def read_listed(path: str) -> bytes | None:
        try:
            return (repository / path).read_bytes()
        except OSError:
            return None

    roots = manifest_roots(listed, read_listed)

    for path in sources:
        if is_test_file(path):
            continue

        try:
            data = (repository / path).read_bytes()
        except OSError:
            continue

        if b"test" not in data:
            continue

        found = scan(data)
        first_pass[path] = found

        for number, (start, stop) in enumerate(found.items):
            entries[f"{path}#{number}"] = sha256_hex(data[start:stop])

    def scan_file(path: str) -> Scan | None:
        try:
            return scan((repository / path).read_bytes())
        except OSError:
            return None

    for path in sorted(test_file_set(sources, first_pass, scan_file, roots.is_root)):
        try:
            entries[f"{path}#file"] = sha256_hex((repository / path).read_bytes())
        except OSError:
            continue

    return entries
