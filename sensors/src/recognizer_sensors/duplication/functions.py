from dataclasses import dataclass

from tree_sitter import Node

FUNCTION_TYPES = {
    "python": {"function_definition"},
    "typescript": {"function_declaration", "method_definition"},
    "tsx": {"function_declaration", "method_definition"},
    "kotlin": {"function_declaration"},
    "rust": {"function_item"},
}

BOUND_FUNCTION_TYPES = {"arrow_function", "function_expression", "function"}

SCOPE_TYPES = {
    "python": {"class_definition"},
    "typescript": {
        "class_declaration",
        "abstract_class_declaration",
        "class",
        "internal_module",
        "module",
    },
    "tsx": {
        "class_declaration",
        "abstract_class_declaration",
        "class",
        "internal_module",
        "module",
    },
    "kotlin": {"class_declaration", "object_declaration", "companion_object"},
    "rust": {"impl_item", "trait_item", "mod_item"},
}

NAME_LEAF_TYPES = {"identifier", "type_identifier", "property_identifier", "simple_identifier"}


@dataclass(frozen=True)
class FoundFunction:
    node: Node
    qualified: str


def node_name(node: Node) -> str | None:
    named = node.child_by_field_name("name")

    if named is not None:
        return named.text.decode("utf-8", "replace")

    if node.type == "impl_item":
        target = node.child_by_field_name("type")

        return target.text.decode("utf-8", "replace").split("<")[0] if target else None

    if node.type == "companion_object":
        return next(
            (c.text.decode("utf-8", "replace") for c in node.children if c.type in NAME_LEAF_TYPES),
            "Companion",
        )

    return next(
        (c.text.decode("utf-8", "replace") for c in node.children if c.type in NAME_LEAF_TYPES),
        None,
    )


def bound_name(node: Node) -> str | None:
    parent = node.parent

    if parent is None or parent.type != "variable_declarator":
        return None

    value = parent.child_by_field_name("value")
    name = parent.child_by_field_name("name")

    if value is None or value.id != node.id or name is None or name.type != "identifier":
        return None

    return name.text.decode("utf-8", "replace")


def function_name(node: Node, grammar: str) -> str | None:
    if node.type in FUNCTION_TYPES[grammar]:
        return node_name(node)

    if grammar in ("typescript", "tsx") and node.type in BOUND_FUNCTION_TYPES:
        return bound_name(node)

    return None


def find_functions(root: Node, grammar: str) -> list[FoundFunction]:
    found: list[FoundFunction] = []
    scope_types = SCOPE_TYPES[grammar]

    def visit(node: Node, scope: tuple[str, ...]) -> None:
        inner = scope
        name = function_name(node, grammar)

        if name is not None:
            found.append(FoundFunction(node, ".".join((*scope, name))))
            inner = (*scope, name)
        elif node.type in scope_types:
            scope_name = node_name(node)

            if scope_name is not None:
                inner = (*scope, scope_name)

        for child in node.children:
            visit(child, inner)

    visit(root, ())

    return found
