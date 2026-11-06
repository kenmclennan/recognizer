import hashlib
import re
from collections.abc import Collection
from pathlib import Path, PurePosixPath

from recognizer_sensors.mutation.test_files import is_test_file

WHITESPACE = b" \t\n\r\x0b\x0c"

WORD = re.compile(rb"[A-Za-z_][A-Za-z0-9_]*")

ROOT_STEMS = {"lib", "main", "mod"}


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


def is_test_attribute(inner: bytes) -> bool:
    compact = bytes(byte for byte in inner if byte not in WHITESPACE)

    if compact == b"test":
        return True

    rest = inner.strip(WHITESPACE)

    if not rest.startswith(b"cfg"):
        return False

    rest = rest[3:].lstrip(WHITESPACE)

    if not (rest.startswith(b"(") and rest.endswith(b")")):
        return False

    words = WORD.findall(rest[1:-1])

    return b"test" in words and b"not" not in words


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


def declared_module(text: bytes) -> str | None:
    i = 0
    n = len(text)

    def skip_space(at: int) -> int:
        while at < n and text[at] in WHITESPACE:
            at += 1

        return at

    i = skip_space(i)

    if text.startswith(b"pub", i):
        after = i + 3

        if after < n and text[after] == 0x28:
            close = text.find(b")", after)

            if close < 0:
                return None

            i = skip_space(close + 1)
        elif after < n and text[after] in WHITESPACE:
            i = skip_space(after)
        else:
            return None

    if not text.startswith(b"mod", i):
        return None

    after = i + 3

    if after >= n or text[after] not in WHITESPACE:
        return None

    i = skip_space(after)
    match = WORD.match(text, i)

    if match is None:
        return None

    i = skip_space(match.end())

    if i < n and text[i] == 0x3B:
        return match.group().decode("ascii")

    return None


def scan(data: bytes) -> tuple[list[tuple[int, int]], bool, list[str]]:
    items: list[tuple[int, int]] = []
    modules: list[str] = []
    file_level = False
    i = 0

    while i < len(data):
        skipped = skip_literal(data, i)

        if skipped is not None:
            i = skipped
            continue

        if data.startswith(b"#![", i):
            end = attribute_end(data, i + 3)

            if is_test_attribute(attribute_inner(data, i, end, 3)):
                file_level = True

            i = end
            continue

        if data.startswith(b"#[", i):
            start = i
            end = attribute_end(data, i + 2)
            is_test = is_test_attribute(attribute_inner(data, i, end, 2))
            follow = skip_trivia(data, end)

            while data.startswith(b"#[", follow):
                end = attribute_end(data, follow + 2)
                is_test = is_test or is_test_attribute(attribute_inner(data, follow, end, 2))
                follow = skip_trivia(data, end)

            if not is_test:
                i = end
                continue

            stop = item_end(data, end)
            items.append((start, stop))
            name = declared_module(data[end:stop])

            if name is not None:
                modules.append(name)

            i = max(stop, end)
            continue

        i += 1

    return items, file_level, modules


def module_directory(file: PurePosixPath) -> PurePosixPath:
    if file.stem in ROOT_STEMS:
        return file.parent

    return file.parent / file.stem


def module_name_of(file: PurePosixPath) -> str:
    return file.parent.name if file.stem == "mod" else file.stem


def in_file_test_hashes(repository: Path, listed: Collection[str]) -> dict[str, str]:
    sources = sorted({path for path in listed if path.endswith(".rs")})
    entries: dict[str, str] = {}
    declared: list[tuple[PurePosixPath, str]] = []

    for path in sources:
        if is_test_file(path):
            continue

        try:
            data = (repository / path).read_bytes()
        except OSError:
            continue

        if b"test" not in data:
            continue

        items, file_level, modules = scan(data)

        for number, (start, stop) in enumerate(items):
            entries[f"{path}#{number}"] = sha256_hex(data[start:stop])

        if file_level:
            entries[f"{path}#file"] = sha256_hex(data)

        declared.extend((PurePosixPath(path), name) for name in modules)

    for declaring, name in declared:
        directory = module_directory(declaring)
        prefix = "" if str(directory) == "." else f"{directory}/"

        for path in sources:
            if not path.startswith(prefix) or module_name_of(PurePosixPath(path)) != name:
                continue

            try:
                entries[f"{path}#file"] = sha256_hex((repository / path).read_bytes())
            except OSError:
                continue

    return entries
