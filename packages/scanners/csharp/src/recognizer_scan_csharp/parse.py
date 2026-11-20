from dataclasses import dataclass

import tree_sitter_c_sharp
from tree_sitter import Language, Node, Parser

LANGUAGE = Language(tree_sitter_c_sharp.language())
BYTE_ORDER_MARK = b"\xef\xbb\xbf"
FLATTENED = ("ERROR", "preproc_if", "preproc_elif", "preproc_else", "preproc_region")


@dataclass
class Parsed:
    root: Node
    damaged: bool
    text: str


def parse_file(data: bytes) -> Parsed:
    body = data[len(BYTE_ORDER_MARK) :] if data.startswith(BYTE_ORDER_MARK) else data
    tree = Parser(LANGUAGE).parse(body)

    return Parsed(tree.root_node, tree.root_node.has_error, body.decode("utf-8", errors="replace"))


def flatten(children: list[Node]) -> list[Node]:
    found = []

    for item in children:
        if item.type in FLATTENED:
            found.extend(flatten(item.children))
        else:
            found.append(item)

    return found
