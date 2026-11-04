from dataclasses import dataclass

from tree_sitter import Node

FUNCTION_TYPES = {
    "python": {"function_definition"},
    "typescript": {"function_declaration", "method_definition"},
    "tsx": {"function_declaration", "method_definition"},
    "kotlin": {"function_declaration"},
    "rust": {"function_item"},
    "csharp": {
        "method_declaration",
        "constructor_declaration",
        "local_function_statement",
        "accessor_declaration",
        "destructor_declaration",
        "operator_declaration",
        "conversion_operator_declaration",
        "property_declaration",
        "indexer_declaration",
    },
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
    "csharp": {
        "class_declaration",
        "struct_declaration",
        "record_declaration",
        "interface_declaration",
        "property_declaration",
        "indexer_declaration",
        "event_declaration",
    },
}

CSHARP_PROPERTY_TYPES = {"property_declaration", "indexer_declaration"}

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

    if node.type == "indexer_declaration":
        return "this"

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


def text_of(node: Node | None) -> str | None:
    return node.text.decode("utf-8", "replace") if node is not None else None


def csharp_name(node: Node) -> str | None:
    kind = node.type

    if kind in CSHARP_PROPERTY_TYPES:
        value = node.child_by_field_name("value")

        if value is None or value.type != "arrow_expression_clause":
            return None

        return (
            "this" if kind == "indexer_declaration" else text_of(node.child_by_field_name("name"))
        )

    if node.child_by_field_name("body") is None:
        return None

    if kind == "accessor_declaration":
        return text_of(node.child_by_field_name("name"))

    if kind == "destructor_declaration":
        return "~" + (text_of(node.child_by_field_name("name")) or "")

    if kind == "operator_declaration":
        return "operator " + (text_of(node.child_by_field_name("operator")) or "")

    if kind == "conversion_operator_declaration":
        return "operator " + (text_of(node.child_by_field_name("type")) or "")

    return text_of(node.child_by_field_name("name"))


def function_name(node: Node, grammar: str) -> str | None:
    if grammar == "csharp":
        return csharp_name(node) if node.type in FUNCTION_TYPES[grammar] else None

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
