from tree_sitter import Node

LITERAL_TYPES = {
    "string",
    "string_fragment",
    "string_content",
    "template_string",
    "number",
    "integer",
    "float",
    "true",
    "false",
    "none",
    "null",
    "undefined",
    "regex",
}

CALL_TYPES = {"call", "call_expression", "invocation_expression"}

MEMBER_FIELDS = {
    "attribute": "attribute",
    "member_expression": "property",
    "member_access_expression": "name",
    "field_expression": "field",
    "scoped_identifier": "name",
    "scoped_expression": "name",
    "navigation_expression": None,
    "navigation_suffix": None,
}

IDENTIFIER_TOKEN = "ID"
LITERAL_TOKEN = "LIT"

Normalised = tuple[str, tuple["Normalised", ...]]


def is_comment(node_type: str) -> bool:
    return "comment" in node_type


def is_literal(node_type: str) -> bool:
    return node_type.endswith("_literal") or node_type in LITERAL_TYPES


def is_identifier(node: Node) -> bool:
    return node.child_count == 0 and (
        node.type == "identifier" or node.type.endswith("_identifier") or node.type == "self"
    )


def callee_of(call: Node) -> Node | None:
    named = call.child_by_field_name("function")

    if named is not None:
        return named

    return call.named_children[0] if call.named_children else None


def final_name(node: Node) -> Node | None:
    if node.child_count == 0:
        return node

    if node.type not in MEMBER_FIELDS:
        return None

    field = MEMBER_FIELDS[node.type]
    target = node.child_by_field_name(field) if field else None

    if target is None and node.named_children:
        target = node.named_children[-1]

    return final_name(target) if target is not None else None


def normalise(node: Node, kept: set[int]) -> Normalised | None:
    node_type = node.type

    if is_comment(node_type):
        return None

    if is_literal(node_type):
        return (LITERAL_TOKEN, ())

    if node_type in CALL_TYPES:
        callee = callee_of(node)
        leaf = final_name(callee) if callee is not None else None

        if leaf is not None:
            kept.add(leaf.id)

    if is_identifier(node):
        return (node.text.decode("utf-8", "replace") if node.id in kept else IDENTIFIER_TOKEN, ())

    if node.child_count == 0:
        return (node_type, ())

    children = tuple(
        child for child in (normalise(c, kept) for c in node.children) if child is not None
    )

    return (node_type, children)


def count_nodes(node: Node) -> int:
    return 1 + sum(count_nodes(child) for child in node.children)
