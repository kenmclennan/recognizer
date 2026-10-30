import re
from dataclasses import dataclass, field

from tree_sitter import Node

from recognizer_scan_kotlin.parse import DECLARATIONS, Parsed

VALUE_LIMIT = 40
SHORT_TEMPLATE = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")
BODIES = ("class_body", "enum_class_body")
COMPANION_NAME = "Companion"


def text_of(node: Node) -> str:
    return node.text.decode("utf-8", errors="replace")


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def shorten(text: str) -> str:
    text = collapse(text)

    return text if len(text) <= VALUE_LIMIT else text[: VALUE_LIMIT - 1] + "…"


def child(node: Node, *types: str) -> Node | None:
    return next((c for c in node.children if c.type in types), None)


def line_of(node: Node) -> int:
    return node.start_point[0] + 1


def name_of(node: Node) -> str | None:
    found = child(node, "identifier")

    return text_of(found) if found else None


def modifier_words(node: Node) -> list[str]:
    modifiers = child(node, "modifiers")

    if modifiers is None:
        return []

    return [text_of(c) for c in modifiers.children if c.type != "annotation"]


def visibility_of(node: Node) -> str:
    for word in modifier_words(node):
        if word in ("private", "protected", "internal", "public"):
            return word

    return "public"


def property_name(node: Node) -> str | None:
    declaration = child(node, "variable_declaration", "multi_variable_declaration")

    if declaration is None:
        return None

    return name_of(declaration) or next(
        (name_of(c) for c in declaration.children if c.type == "variable_declaration"), None
    )


def segments_of(node: Node) -> list[str]:
    return [text_of(c) for c in node.children if c.type == "identifier"]


def type_node(owner: Node) -> Node | None:
    seen_colon = False

    for item in owner.children:
        if item.type == ":":
            seen_colon = True
        elif seen_colon and item.type not in ("function_body", "="):
            return item

        if item.type in ("function_body", "="):
            return None

    return None


def type_segments(node: Node | None) -> list[str] | None:
    if node is None:
        return None

    if node.type == "user_type":
        return segments_of(node)

    for item in node.children:
        found = type_segments(item) if item.type in ("user_type", "nullable_type") else None

        if found:
            return found

    return None


@dataclass
class Import:
    path: tuple[str, ...]
    alias: str | None
    wildcard: bool
    line: int

    @property
    def text(self) -> str:
        return ".".join(self.path) + (".*" if self.wildcard else "")

    @property
    def binding(self) -> str:
        return self.alias or self.path[-1]


@dataclass
class Decl:
    name: str
    kind: str
    line: int
    visibility: str
    node: Node | None
    owner: str | None = None
    is_object: bool = False
    members: set[str] = field(default_factory=set)
    supertypes: list[list[str]] = field(default_factory=list)


@dataclass
class SourceFile:
    path: str
    directory: str
    package: str
    imports: list[Import]
    decls: list[Decl]
    uses: dict[str, int]
    chains: list[tuple[int, list[str]]]
    damaged: bool


def read_import(node: Node) -> Import | None:
    qualified = child(node, "qualified_identifier")

    if qualified is None:
        return None

    alias = None
    seen_as = False

    for item in node.children:
        if item.type == "as":
            seen_as = True
        elif seen_as and item.type == "identifier":
            alias = text_of(item)

    return Import(
        tuple(segments_of(qualified)),
        alias,
        any(c.type == "*" for c in node.children),
        line_of(node),
    )


def class_body(node: Node) -> Node | None:
    return child(node, *BODIES)


def member_names(node: Node) -> set[str]:
    names = set()
    constructor = child(node, "primary_constructor")
    parameters = child(constructor, "class_parameters") if constructor else None

    for parameter in parameters.children if parameters else []:
        if parameter.type == "class_parameter" and child(parameter, "val", "var"):
            names.add(name_of(parameter) or "")

    body = class_body(node)

    for item in body.children if body else []:
        if item.type == "function_declaration":
            names.add(name_of(item) or "")
        elif item.type == "property_declaration":
            names.add(property_name(item) or "")
        elif item.type in ("class_declaration", "object_declaration", "enum_entry"):
            names.add(name_of(item) or "")
        elif item.type == "companion_object":
            names |= member_names(item)

    names.discard("")

    return names


def supertypes_of(node: Node) -> list[list[str]]:
    specifiers = child(node, "delegation_specifiers")
    found = []

    for specifier in specifiers.children if specifiers else []:
        if specifier.type != "delegation_specifier":
            continue

        for inner in specifier.children:
            holder = inner if inner.type == "user_type" else child(inner, "user_type")
            segments = segments_of(holder) if holder else []

            if segments:
                found.append(segments)

    return found


def decl_of(node: Node) -> list[Decl]:
    name = name_of(node)
    visibility = visibility_of(node)

    if node.type == "class_declaration":
        kind = "interface" if child(node, "interface") else "class"
        decl = Decl(name or "", kind, line_of(child(node, "identifier") or node), visibility, node)
        decl.members = member_names(node)
        decl.supertypes = supertypes_of(node)
        found = [decl]
    elif node.type == "object_declaration":
        decl = Decl(
            name or "", "class", line_of(child(node, "identifier") or node), visibility, node
        )
        decl.is_object = True
        decl.members = member_names(node)
        decl.supertypes = supertypes_of(node)
        found = [decl]
    elif node.type == "type_alias":
        found = [Decl(name or "", "type", line_of(node), visibility, node)]
    elif node.type == "function_declaration":
        found = [Decl(name or "", "function", line_of(node), visibility, node)]
    else:
        found = [Decl(property_name(node) or "", "constant", line_of(node), visibility, node)]

    outer = found[0]
    body = class_body(node) if node.type in ("class_declaration", "object_declaration") else None

    for item in body.children if body else []:
        if item.type == "companion_object":
            companion = name_of(item) or COMPANION_NAME
            found.append(
                Decl(
                    f"{outer.name}.{companion}",
                    "class",
                    line_of(item),
                    visibility_of(item),
                    item,
                    owner=outer.name,
                    is_object=True,
                    members=member_names(item),
                )
            )

    return [d for d in found if d.name]


def walk(root: Node):
    stack = [root]

    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.children))


def chain_of(node: Node) -> list[str] | None:
    if node.type == "identifier":
        return [text_of(node)]

    if node.type == "navigation_expression" and len(node.children) >= 3:
        left = chain_of(node.children[0])
        right = node.children[-1]

        if left and right.type == "identifier":
            return [*left, text_of(right)]

    return None


def collect_uses(roots: list[Node]) -> tuple[dict[str, int], list[tuple[int, list[str]]]]:
    uses: dict[str, int] = {}
    chains: list[tuple[int, list[str]]] = []

    def note(name: str, line: int) -> None:
        if name not in uses or line < uses[name]:
            uses[name] = line

    for root in roots:
        pending = [(root, False)]

        while pending:
            node, skipped = pending.pop()

            if node.type in ("package_header", "import"):
                continue

            if node.type == "identifier":
                note(text_of(node), line_of(node))
            elif node.type == "string_literal":
                body = text_of(node)

                for found in SHORT_TEMPLATE.finditer(body):
                    note(found[1], line_of(node) + body[: found.start()].count("\n"))
            elif node.type == "user_type":
                segments = segments_of(node)

                if len(segments) > 1:
                    chains.append((line_of(node), segments))
            elif node.type == "navigation_expression" and not skipped:
                segments = chain_of(node)

                if segments:
                    chains.append((line_of(node), segments))

            inner = node.type == "navigation_expression"
            pending.extend((c, inner) for c in node.children)

    return uses, chains


def read_declarations(roots: list[Node]) -> list[Decl]:
    found = []

    for root in roots:
        for node in root.children:
            if node.type in DECLARATIONS:
                found.extend(decl_of(node))

    return found


def fill_from_patterns(parsed: Parsed, decls: list[Decl]) -> None:
    known = {d.name for d in decls}

    for hit in parsed.hits:
        if hit.name not in known:
            known.add(hit.name)
            decls.append(Decl(hit.name, hit.kind, hit.line, hit.visibility, None))

    for outer, companion, line in parsed.companions:
        name = f"{outer}.{companion or COMPANION_NAME}"

        if name not in known:
            known.add(name)
            decls.append(Decl(name, "class", line, "public", None, owner=outer, is_object=True))


def read_source(path: str, directory: str, parsed: Parsed) -> SourceFile:
    package = ""
    imports = []

    for root in parsed.roots:
        for node in root.children:
            if node.type == "package_header":
                qualified = child(node, "qualified_identifier")
                package = ".".join(segments_of(qualified)) if qualified else ""
            elif node.type == "import":
                found = read_import(node)

                if found:
                    imports.append(found)

    decls = read_declarations(parsed.roots)

    if parsed.damaged:
        fill_from_patterns(parsed, decls)

    uses, chains = collect_uses(parsed.roots)

    return SourceFile(path, directory, package, imports, decls, uses, chains, parsed.damaged)
