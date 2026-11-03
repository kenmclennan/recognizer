from dataclasses import dataclass

from tree_sitter import Node

SWAPS = {
    "==": "!=",
    "!=": "==",
    "<": "<=",
    "<=": "<",
    ">": ">=",
    ">=": ">",
    "+": "-",
    "-": "+",
    "*": "/",
    "/": "*",
    "&&": "||",
    "||": "&&",
    "and": "or",
    "or": "and",
    "===": "!==",
    "!==": "===",
    "??": "&&",
}

COMPARISONS = {"==", "!=", "<", "<=", ">", ">="}
ARITHMETIC = {"+", "-", "*", "/"}
LOGICAL = {"&&", "||"}
STRICT = {"===", "!=="}

C_LIKE_PARENT = "binary_expression"
TYPESCRIPT = ("typescript", "tsx")


@dataclass(frozen=True)
class Site:
    line: int
    column: int
    start_byte: int
    end_byte: int
    operator: str
    replacement: str


def operators_for(grammar: str, parent: str) -> set[str]:
    if grammar == "python":
        return {
            "comparison_operator": COMPARISONS,
            "binary_operator": ARITHMETIC,
            "boolean_operator": {"and", "or"},
        }.get(parent, set())

    if parent != C_LIKE_PARENT:
        return set()

    allowed = COMPARISONS | ARITHMETIC | LOGICAL

    if grammar in TYPESCRIPT:
        allowed = allowed | STRICT | {"??"}

    return allowed


def is_inside_text(node: Node) -> bool:
    ancestor = node.parent

    while ancestor is not None:
        if "string" in ancestor.type or "comment" in ancestor.type:
            return True

        ancestor = ancestor.parent

    return False


def boolean_site(node: Node, grammar: str) -> Site | None:
    text = node.text.decode("utf-8", "replace")

    if text not in ("true", "false", "True", "False"):
        return None

    if grammar == "python":
        valid = node.type in ("true", "false") and node.is_named
    elif grammar == "rust":
        valid = node.parent is not None and node.parent.type == "boolean_literal"
    elif grammar == "kotlin":
        valid = node.type == "identifier" and text in ("true", "false")
    else:
        valid = node.type in ("true", "false") and node.is_named

    if not valid:
        return None

    flipped = {"true": "false", "false": "true", "True": "False", "False": "True"}[text]

    return site_for(node, text, flipped)


def site_for(node: Node, operator: str, replacement: str) -> Site:
    return Site(
        node.start_point[0] + 1,
        node.start_point[1],
        node.start_byte,
        node.end_byte,
        operator,
        replacement,
    )


def not_site(node: Node) -> Site | None:
    operand = node.parent.child_by_field_name("argument") if node.parent else None

    if operand is None:
        return None

    return Site(
        node.start_point[0] + 1,
        node.start_point[1],
        node.start_byte,
        operand.start_byte,
        "not",
        "",
    )


def leaf_site(node: Node, grammar: str) -> Site | None:
    parent = node.parent

    if parent is None:
        return None

    kind = node.type

    if grammar == "python" and kind == "not" and parent.type == "not_operator":
        return not_site(node)

    if kind in SWAPS and kind in operators_for(grammar, parent.type):
        return site_for(node, kind, SWAPS[kind])

    return boolean_site(node, grammar)


def find_sites(root: Node, grammar: str) -> list[Site]:
    sites: list[Site] = []
    stack = [root]

    while stack:
        node = stack.pop()

        if node.child_count:
            stack.extend(node.children)

            continue

        if is_inside_text(node):
            continue

        site = leaf_site(node, grammar)

        if site is not None:
            sites.append(site)

    return sorted(sites, key=lambda site: site.start_byte)
