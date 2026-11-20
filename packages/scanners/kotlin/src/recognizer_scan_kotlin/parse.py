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
    "import_list",
    "line_comment",
    "multiline_comment",
    "file_annotation",
    "shebang_line",
    "getter",
    "setter",
}
LEADING_ARROW = re.compile(r"^(\s*)->(.*)$")


@dataclass
class Parsed:
    roots: list[Node]
    damaged: bool
    trees: list[Tree] = field(default_factory=list)


def is_damaged(root: Node) -> bool:
    return root.has_error or any(child.type not in EXPECTED_TOP_LEVEL for child in root.children)


def repair_lambda_arrows(text: str) -> str:
    lines = text.split("\n")

    for number in range(1, len(lines)):
        found = LEADING_ARROW.match(lines[number])

        if (
            found
            and lines[number - 1].strip()
            and not lines[number - 1].rstrip().endswith(("{", ";"))
        ):
            lines[number - 1] = f"{lines[number - 1].rstrip()} ->"
            lines[number] = f"{found[1]}  {found[2]}"

    return "\n".join(lines)


def parse_whole(data: bytes) -> Parsed:
    tree = PARSER.parse(data)

    return Parsed([tree.root_node], is_damaged(tree.root_node), trees=[tree])


def parse_file(data: bytes) -> Parsed:
    parsed = parse_whole(data)

    if not parsed.damaged:
        return parsed

    repaired = parse_whole(repair_lambda_arrows(data.decode("utf-8", errors="replace")).encode())

    return parsed if repaired.damaged else repaired
