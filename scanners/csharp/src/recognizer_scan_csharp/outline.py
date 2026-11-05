from tree_sitter import Node

from recognizer_scan_csharp.declarations import (
    Decl,
    child,
    collapse,
    line_of,
    modifier_words,
    name_node_of,
    text_of,
    visibility_of,
)
from recognizer_scan_csharp.parse import flatten

FIELD_HOLDERS = ("field_declaration",)


def type_text(owner: Node, field_name: str = "type") -> str | None:
    found = owner.child_by_field_name(field_name)

    return collapse(text_of(found)) if found is not None else None


def parameter(node: Node) -> dict:
    name = name_node_of(node)
    found = {"name": text_of(name) if name is not None else ""}
    declared = type_text(node)

    if declared:
        found["type"] = declared

    return found


def parameters(owner: Node) -> list[dict]:
    holder = owner.child_by_field_name("parameters")

    return [parameter(p) for p in holder.children if p.type == "parameter"] if holder else []


def field_of(name: Node, owner: Node, private: bool) -> dict:
    found = {"name": text_of(name), "line": line_of(name), "private": private}
    declared = type_text(owner)

    if declared:
        found["type"] = declared

    return found


def is_private(words: list[str], interface: bool) -> bool:
    if interface:
        return "private" in words and "protected" not in words

    return visibility_of(words, True) == "private"


def body_items(decl: Decl) -> list[Node]:
    body = child(decl.node, "declaration_list", "enum_member_declaration_list")

    return flatten(body.children) if body else []


def fields_of(decl: Decl) -> list[dict]:
    found = []
    record = decl.node.type.startswith("record")
    holder = child(decl.node, "parameter_list")

    for item in holder.children if holder else []:
        name = name_node_of(item) if item.type == "parameter" else None

        if name is not None:
            found.append(field_of(name, item, not record))

    for item in body_items(decl):
        words = modifier_words(item)
        private = is_private(words, decl.kind == "interface") or (
            item.type == "field_declaration"
            and not any(w in words for w in ("public", "protected", "internal"))
        )

        if item.type == "property_declaration" and name_node_of(item) is not None:
            found.append(field_of(name_node_of(item), item, private))
        elif item.type == "enum_member_declaration" and name_node_of(item) is not None:
            found.append(
                {"name": text_of(name_node_of(item)), "line": line_of(item), "private": False}
            )
        elif item.type in FIELD_HOLDERS:
            declaration = child(item, "variable_declaration")

            for declarator in declaration.children if declaration else []:
                name = (
                    name_node_of(declarator) if declarator.type == "variable_declarator" else None
                )

                if name is not None:
                    found.append(field_of(name, declaration, private))

    return sorted(found, key=lambda f: f["line"])


def method_of(node: Node, decl: Decl) -> dict:
    words = modifier_words(node)
    interface = decl.kind == "interface"
    name = name_node_of(node)
    method = {
        "name": text_of(name) if name is not None else decl.name,
        "line": line_of(name or node),
        "end_line": node.end_point[0] + 1,
        "params": parameters(node),
        "private": is_private(words, interface),
    }
    returns = type_text(node, "type" if node.type == "property_declaration" else "returns")

    if returns:
        method["returns"] = returns

    tags = []

    if "static" in words:
        tags.append("static")

    bodiless = (
        node.child_by_field_name("body") is None and child(node, "arrow_expression_clause") is None
    )

    if "abstract" in words or (interface and bodiless and node.type == "method_declaration"):
        tags.append("abstract")

    if "async" in words:
        tags.append("async")

    if tags:
        method["tags"] = tags

    return method


def extension_members(item: Node) -> list[Node]:
    body = child(item, "extension_body")

    return [
        inner
        for inner in flatten(body.children if body else [])
        if inner.type in ("method_declaration", "property_declaration")
    ]


def method_items(decl: Decl) -> list[Node]:
    found = []

    for item in body_items(decl):
        if item.type in ("method_declaration", "constructor_declaration"):
            found.append(item)
        elif item.type == "extension_declaration":
            found.extend(extension_members(item))

    return found


def methods_of(decl: Decl) -> list[dict]:
    return [method_of(item, decl) for item in method_items(decl)]


def class_outline(decl: Decl) -> dict:
    found = {
        "bases": list(decl.base_texts),
        "fields": fields_of(decl),
        "methods": methods_of(decl),
    }

    if decl.kind == "class" and decl.abstract:
        found["tags"] = ["abstract"]

    return found


def member_of(decl: Decl) -> dict:
    visibility = "private" if decl.visibility == "file" else decl.visibility

    return {
        "name": decl.name,
        "kind": decl.kind,
        "line": decl.line,
        "exported": visibility != "private",
        "visibility": visibility,
    } | class_outline(decl)
