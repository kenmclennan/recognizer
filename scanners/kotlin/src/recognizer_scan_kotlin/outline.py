from tree_sitter import Node

from recognizer_scan_kotlin.declarations import (
    Decl,
    child,
    class_body,
    collapse,
    line_of,
    modifier_words,
    name_of,
    property_name,
    shorten,
    text_of,
    type_node,
    visibility_of,
)


def type_text(owner: Node) -> str | None:
    found = type_node(owner)

    return collapse(text_of(found)) if found else None


def parameter(node: Node) -> dict:
    found = {"name": name_of(node) or ""}
    declared = type_text(node)

    if declared:
        found["type"] = declared

    return found


def parameters(function: Node) -> list[dict]:
    holder = child(function, "function_value_parameters")

    return [parameter(p) for p in holder.children if p.type == "parameter"] if holder else []


def bases_of(node: Node) -> list[str]:
    specifiers = child(node, "delegation_specifiers")
    found = []

    for specifier in specifiers.children if specifiers else []:
        if specifier.type != "delegation_specifier":
            continue

        for inner in specifier.children:
            holder = inner if inner.type == "user_type" else child(inner, "user_type")

            if holder is not None:
                found.append(collapse(text_of(holder)))

    return found


def field_of(name: str, line: int, owner: Node, private: bool) -> dict:
    found = {"name": name, "line": line, "private": private}
    declared = type_text(owner)

    if declared:
        found["type"] = declared

    return found


def fields_of(node: Node) -> list[dict]:
    found = []
    constructor = child(node, "primary_constructor")
    parameters_node = child(constructor, "class_parameters") if constructor else None

    for item in parameters_node.children if parameters_node else []:
        if item.type == "class_parameter" and child(item, "val", "var"):
            identifier = child(item, "identifier")
            found.append(
                field_of(
                    name_of(item) or "",
                    line_of(identifier or item),
                    item,
                    visibility_of(item) == "private",
                )
            )

    body = class_body(node)

    for item in body.children if body else []:
        if item.type != "property_declaration":
            continue

        declaration = child(item, "variable_declaration")
        name = property_name(item)

        if name and declaration is not None:
            found.append(
                field_of(name, line_of(declaration), declaration, visibility_of(item) == "private")
            )

    return sorted(found, key=lambda f: f["line"])


def method_of(node: Node, interface: bool, static: bool) -> dict:
    identifier = child(node, "identifier")
    method = {
        "name": name_of(node) or "",
        "line": line_of(identifier or node),
        "params": parameters(node),
        "private": visibility_of(node) == "private",
    }
    returns = type_text(node)

    if returns:
        method["returns"] = returns

    tags = []

    if static:
        tags.append("static")

    if "abstract" in modifier_words(node) or (interface and child(node, "function_body") is None):
        tags.append("abstract")

    if tags:
        method["tags"] = tags

    return method


def methods_of(node: Node, interface: bool, static: bool) -> list[dict]:
    body = class_body(node)

    return [
        method_of(item, interface, static)
        for item in (body.children if body else [])
        if item.type == "function_declaration"
    ]


def class_outline(decl: Decl) -> dict:
    node = decl.node
    companion = node.type == "companion_object"

    return {
        "bases": [] if companion else bases_of(node),
        "fields": fields_of(node),
        "methods": methods_of(node, decl.kind == "interface", companion),
    }


def function_outline(node: Node) -> dict:
    found = {"params": parameters(node)}
    returns = type_text(node)

    if returns:
        found["returns"] = returns

    if "abstract" in modifier_words(node):
        found["tags"] = ["abstract"]

    return found


def constant_outline(node: Node) -> dict:
    marks = [c.type for c in node.children]

    if "=" not in marks:
        return {}

    following = node.children[marks.index("=") + 1 :]

    return {"value": shorten(text_of(following[0]))} if following else {}


def member_of(decl: Decl) -> dict:
    member = {
        "name": decl.name,
        "kind": decl.kind,
        "line": decl.line,
        "exported": decl.visibility != "private",
        "visibility": decl.visibility,
    }

    if decl.node is None:
        return member

    if decl.kind in ("class", "interface"):
        return member | class_outline(decl)

    if decl.kind == "function":
        return member | function_outline(decl.node)

    if decl.kind == "constant":
        return member | constant_outline(decl.node)

    return member
