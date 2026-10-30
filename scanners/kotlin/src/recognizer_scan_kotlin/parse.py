import re
from dataclasses import dataclass, field

import tree_sitter_kotlin
from tree_sitter import Language, Node, Parser, Tree

PARSER = Parser(Language(tree_sitter_kotlin.language()))

DECLARATIONS = {
    "class_declaration",
    "object_declaration",
    "function_declaration",
    "property_declaration",
    "type_alias",
}
EXPECTED_TOP_LEVEL = DECLARATIONS | {
    "package_header",
    "import",
    "line_comment",
    "block_comment",
    "file_annotation",
    "shebang_line",
}
MODIFIERS = (
    "public|private|protected|internal|abstract|open|final|sealed|data|enum|annotation|inner|"
    "value|inline|suspend|override|operator|infix|tailrec|external|const|lateinit|expect|actual"
)
CHUNK_START = re.compile(
    rf"^\s*(?:@|(?:{MODIFIERS}|fun|interface|class|object|typealias|val|var|package|import)\b)"
)
HIT = re.compile(
    r"^\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*"
    rf"(?P<mods>(?:(?:{MODIFIERS}|fun(?=\s+interface))\s+)*)"
    r"(?P<keyword>class|interface|object|typealias|fun|val|var)\s+(?P<rest>.*)"
)
FUNCTION_NAME = re.compile(r"^(?:<[^>]*>\s*)?(?:[\w<>?,.\s]*?\.)?(\w+)\s*\(")
PROPERTY_NAME = re.compile(r"^(?:<[^>]*>\s*)?(?:[\w<>?.]+\.)?(\w+)")
PLAIN_NAME = re.compile(r"^(\w+)")
COMPANION = re.compile(r"\bcompanion\s+object(?:\s+(\w+))?")
KINDS = {
    "class": "class",
    "interface": "interface",
    "object": "class",
    "typealias": "type",
    "fun": "function",
    "val": "constant",
    "var": "constant",
}
VISIBILITIES = ("private", "protected", "internal", "public")


@dataclass(frozen=True)
class Hit:
    name: str
    kind: str
    line: int
    visibility: str


@dataclass
class Parsed:
    roots: list[Node]
    damaged: bool
    hits: list[Hit] = field(default_factory=list)
    companions: list[tuple[str, str | None, int]] = field(default_factory=list)
    trees: list[Tree] = field(default_factory=list)


def is_damaged(root: Node) -> bool:
    return root.has_error or any(child.type not in EXPECTED_TOP_LEVEL for child in root.children)


def line_states(text: str) -> list[tuple[int, bool]]:
    states = [(0, False)]
    depth = 0
    mode = "code"
    nesting = 0
    index = 0

    while index < len(text):
        begin = index
        char = text[index]
        pair = text[index : index + 2]

        if mode == "code":
            if pair == "//":
                mode = "line"
                index += 1
            elif pair == "/*":
                mode = "block"
                nesting = 1
                index += 1
            elif text.startswith('"""', index):
                mode = "raw"
                index += 2
            elif char == '"':
                mode = "string"
            elif char == "'":
                mode = "char"
            elif char in "{([":
                depth += 1
            elif char in "})]":
                depth = max(0, depth - 1)
        elif mode == "line":
            if char == "\n":
                mode = "code"
        elif mode == "block":
            if pair == "/*":
                nesting += 1
                index += 1
            elif pair == "*/":
                nesting -= 1
                index += 1

                if nesting == 0:
                    mode = "code"
        elif mode == "raw":
            if text.startswith('"""', index):
                mode = "code"
                index += 2
        elif mode in ("string", "char"):
            if char == "\\":
                index += 1
            elif (mode == "string" and char == '"') or (mode == "char" and char == "'"):
                mode = "code"
            elif char == "\n":
                mode = "code"

        for skipped in text[begin : index + 1]:
            if skipped == "\n":
                states.append((depth, mode in ("block", "raw")))

        index += 1

    return states


def chunk_starts(lines: list[str], text: str) -> list[int]:
    states = line_states(text)
    starts = [0]

    for number, line in enumerate(lines):
        depth, inside = states[number] if number < len(states) else (0, False)

        if number and depth == 0 and not inside and CHUNK_START.match(line):
            starts.append(number)

    return starts


def read_visibility(modifiers: str) -> str:
    return next((v for v in VISIBILITIES if re.search(rf"\b{v}\b", modifiers)), "public")


def hit_of(line: str, number: int) -> Hit | None:
    found = HIT.match(line)

    if not found:
        return None

    keyword = found["keyword"]
    pattern = {"fun": FUNCTION_NAME, "val": PROPERTY_NAME, "var": PROPERTY_NAME}.get(
        keyword, PLAIN_NAME
    )
    name = pattern.match(found["rest"])

    if not name:
        return None

    kind = KINDS[keyword]

    if "fun interface" in (found["mods"] + keyword):
        kind = "interface"

    return Hit(name[1], kind, number + 1, read_visibility(found["mods"]))


def parse_whole(data: bytes) -> Parsed:
    tree = PARSER.parse(data)

    return Parsed([tree.root_node], is_damaged(tree.root_node), trees=[tree])


def parse_chunks(text: str) -> Parsed:
    lines = text.split("\n")
    starts = chunk_starts(lines, text)
    parsed = Parsed([], True)

    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        body = "\n".join(lines[start:end])
        tree = PARSER.parse(("\n" * start + body).encode())
        parsed.trees.append(tree)
        parsed.roots.append(tree.root_node)
        outer = None

        for offset, line in enumerate(lines[start:end]):
            hit = hit_of(line, start + offset) if offset == 0 else None

            if hit:
                parsed.hits.append(hit)
                outer = outer or hit.name

        if is_damaged(tree.root_node) and outer:
            for match in COMPANION.finditer(body):
                number = start + body[: match.start()].count("\n") + 1
                parsed.companions.append((outer, match[1], number))

    return parsed


def parse_file(data: bytes) -> Parsed:
    parsed = parse_whole(data)

    if not parsed.damaged:
        return parsed

    return parse_chunks(data.decode("utf-8", errors="replace"))
