import re
from dataclasses import dataclass, field

from tree_sitter import Node

from recognizer_scan_csharp.parse import Parsed, flatten

TYPE_NODES = {
    "class_declaration": "class",
    "struct_declaration": "class",
    "record_declaration": "class",
    "record_struct_declaration": "class",
    "interface_declaration": "interface",
    "enum_declaration": "class",
}
BODIES = ("declaration_list", "enum_member_declaration_list")
VISIBILITIES = ("public", "protected", "internal", "private")
ANONYMOUS_NAME_PARENTS = (
    "single_variable_designation",
    "name_colon",
    "name_equals",
    "labeled_statement",
    "goto_statement",
)
MEMBER_NAME_NODES = (
    "method_declaration",
    "property_declaration",
    "event_declaration",
    "enum_member_declaration",
    "local_function_statement",
)
FIELD_NODES = ("field_declaration", "event_field_declaration")
ATTRIBUTE_SUFFIX = "Attribute"


def text_of(node: Node) -> str:
    return node.text.decode("utf-8", errors="replace")


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def line_of(node: Node) -> int:
    return node.start_point[0] + 1


def child(node: Node, *types: str) -> Node | None:
    return next((c for c in node.children if c.type in types), None)


def name_node_of(node: Node) -> Node | None:
    return node.child_by_field_name("name")


def modifier_words(node: Node) -> list[str]:
    return [text_of(c) for c in node.children if c.type == "modifier"]


def join_namespace(base: str, name: str) -> str:
    return f"{base}.{name}" if base else name


def scopes_of(namespace: str) -> list[str]:
    parts = namespace.split(".") if namespace else []

    return [".".join(parts[:n]) for n in range(len(parts), 0, -1)] + [""]


@dataclass
class Using:
    kind: str
    is_global: bool
    alias: str | None
    segments: tuple[str, ...]
    line: int

    @property
    def text(self) -> str:
        return ".".join(self.segments)


@dataclass(eq=False)
class Decl:
    name: str
    kind: str
    namespace: str
    outer: tuple[str, ...]
    visibility: str
    path: str
    line: int
    node: Node
    partial: bool = False
    abstract: bool = False
    static: bool = False
    bases: list[tuple[str, ...]] = field(default_factory=list)
    base_texts: list[str] = field(default_factory=list)
    member_names: set[str] = field(default_factory=set)
    attributes: set[str] = field(default_factory=set)
    extension_names: set[str] = field(default_factory=set)
    static_main: bool = False
    projects: frozenset[str] = frozenset()

    @property
    def key(self) -> tuple[str, tuple[str, ...]]:
        return self.namespace, self.outer + (self.name,)


@dataclass
class SourceFile:
    path: str
    directory: str
    damaged: bool
    text: str
    usings: list[Using] = field(default_factory=list)
    decls: list[Decl] = field(default_factory=list)
    uses: dict[tuple, int] = field(default_factory=dict)
    extension_calls: dict[str, int] = field(default_factory=dict)
    namespaces: set[str] = field(default_factory=set)
    declared_names: set[str] = field(default_factory=set)
    top_level: bool = False
    projects: frozenset[str] = frozenset()
    reach: frozenset[str] = frozenset()


def visibility_of(words: list[str], nested: bool) -> str:
    if "file" in words:
        return "file"

    for word in ("public", "protected", "private", "internal"):
        if word in words:
            return word

    return "private" if nested else "internal"


def last_segment_text(node: Node) -> str:
    return text_of(node).split(".")[-1].strip()


class Collector:
    def __init__(self, path: str, directory: str, parsed: Parsed):
        self.parsed = parsed
        self.file = SourceFile(path, directory, parsed.damaged, parsed.text)

    def collect(self) -> SourceFile:
        self.container(self.parsed.root.children, "")

        return self.file

    def container(self, nodes: list[Node], namespace: str) -> None:
        for node in flatten(nodes):
            kind = node.type

            if kind == "file_scoped_namespace_declaration":
                name = name_node_of(node)
                namespace = text_of(name) if name else namespace
                self.file.namespaces.add(namespace)
            elif kind == "namespace_declaration":
                name = name_node_of(node)
                inner = join_namespace(namespace, text_of(name)) if name else namespace
                self.file.namespaces.add(inner)
                body = node.child_by_field_name("body")
                self.container(body.children if body else [], inner)
            elif kind == "using_directive":
                self.using(node)
            elif kind in TYPE_NODES:
                self.declare(node, namespace, ())
            else:
                if kind == "global_statement":
                    self.file.top_level = True

                self.walk(node, namespace, ())

    def using(self, node: Node) -> None:
        is_global = child(node, "global") is not None
        static = child(node, "static") is not None
        name = name_node_of(node)
        marks = [c.type for c in node.children]
        after = node.children[marks.index("=") + 1 :] if "=" in marks else node.children
        target = next(
            (
                c
                for c in after
                if c.type in ("identifier", "qualified_name", "alias_qualified_name")
            ),
            None,
        )

        if target is None:
            return

        segments = self.chain(target, [])

        if not segments:
            return

        alias = text_of(name) if name is not None and "=" in marks else None
        kind = "alias" if alias else "static" if static else "plain"
        self.file.usings.append(Using(kind, is_global, alias, tuple(segments), line_of(node)))

    def chain(self, node: Node, generics: list[Node]) -> list[str] | None:
        kind = node.type

        if kind == "identifier":
            return [text_of(node)]

        if kind == "generic_name":
            generics.append(node)
            first = child(node, "identifier")

            return [text_of(first)] if first else None

        if kind in ("qualified_name", "member_access_expression"):
            head = node.child_by_field_name(
                "qualifier" if kind == "qualified_name" else "expression"
            )
            tail = name_node_of(node)

            if head is None or tail is None:
                return None

            left = self.chain(head, generics)
            right = self.chain(tail, generics)

            return left + right if left and right else None

        if kind == "alias_qualified_name":
            tail = name_node_of(node)

            return self.chain(tail, generics) if tail else None

        return None

    def use(self, segments: list[str], node: Node, namespace: str, enclosing: tuple) -> None:
        key = (tuple(segments), enclosing, namespace)
        line = line_of(node)
        self.file.uses[key] = min(line, self.file.uses.get(key, line))

    def declare(self, node: Node, namespace: str, outer: tuple[str, ...]) -> None:
        name_node = name_node_of(node)

        if name_node is None:
            return

        name = text_of(name_node)
        words = modifier_words(node)
        decl = Decl(
            name=name,
            kind=TYPE_NODES[node.type],
            namespace=namespace,
            outer=outer,
            visibility=visibility_of(words, bool(outer)),
            path=self.file.path,
            line=line_of(name_node),
            node=node,
            partial="partial" in words,
            abstract="abstract" in words,
            static="static" in words,
            attributes=self.attributes(node),
        )
        self.file.decls.append(decl)
        self.file.declared_names.add(name)
        enclosing = outer + (name,)

        for item in node.children:
            if item == name_node:
                continue

            if item.type == "base_list":
                self.bases(item, decl)

            if item.type in BODIES:
                self.members(item, decl, namespace, enclosing)
            else:
                self.walk(item, namespace, enclosing)

    def attributes(self, node: Node) -> set[str]:
        found = set()

        for lists in node.children:
            if lists.type != "attribute_list":
                continue

            for attribute in lists.children:
                name = name_node_of(attribute) if attribute.type == "attribute" else None

                if name is not None:
                    text = last_segment_text(name)
                    found.add(text.removesuffix(ATTRIBUTE_SUFFIX) or text)

        return found

    def bases(self, node: Node, decl: Decl) -> None:
        for item in node.children:
            target = item

            if item.type == "primary_constructor_base_type":
                target = item.children[0] if item.children else item

            if target.type in (":", ",", "argument_list"):
                continue

            segments = self.chain(target, [])

            if segments:
                decl.bases.append(tuple(segments))
                decl.base_texts.append(collapse(text_of(target)))

    def members(self, body: Node, decl: Decl, namespace: str, enclosing: tuple) -> None:
        for member in flatten(body.children):
            kind = member.type

            if kind in TYPE_NODES:
                inner = name_node_of(member)

                if inner is not None:
                    decl.member_names.add(text_of(inner))

                self.declare(member, namespace, enclosing)

                continue

            self.note_member(member, decl)
            self.walk(member, namespace, enclosing)

    def note_member(self, member: Node, decl: Decl) -> None:
        kind = member.type

        if kind in MEMBER_NAME_NODES:
            name = name_node_of(member)

            if name is not None:
                decl.member_names.add(text_of(name))

            if kind == "method_declaration":
                self.note_method(member, decl)
        elif kind in FIELD_NODES:
            for declarator in member.children:
                for item in (
                    declarator.children if declarator.type == "variable_declaration" else []
                ):
                    name = name_node_of(item) if item.type == "variable_declarator" else None

                    if name is not None:
                        decl.member_names.add(text_of(name))
        elif kind == "extension_declaration":
            body = child(member, "extension_body")

            for inner in flatten(body.children if body else []):
                name = name_node_of(inner) if inner.type in MEMBER_NAME_NODES else None

                if name is not None and "private" not in modifier_words(inner):
                    decl.extension_names.add(text_of(name))
                    decl.member_names.add(text_of(name))

    def note_method(self, member: Node, decl: Decl) -> None:
        name = text_of(name_node_of(member) or member)
        words = modifier_words(member)

        if name == "Main" and "static" in words:
            decl.static_main = True

        if decl.static and "private" not in words:
            parameters = member.child_by_field_name("parameters")
            first = child(parameters, "parameter") if parameters else None

            if first is not None and any(
                text_of(m) == "this" for m in first.children if m.type == "modifier"
            ):
                decl.extension_names.add(name)

    def walk(self, node: Node, namespace: str, enclosing: tuple) -> None:
        kind = node.type

        if kind == "identifier":
            self.use([text_of(node)], node, namespace, enclosing)

            return

        if kind in ("qualified_name", "alias_qualified_name", "generic_name"):
            generics: list[Node] = []
            segments = self.chain(node, generics)

            if segments:
                self.use(segments, node, namespace, enclosing)
                self.generic_arguments(generics, namespace, enclosing)

                return

        if kind == "member_access_expression":
            self.member_access(node, namespace, enclosing)

            return

        if kind == "member_binding_expression":
            tail = name_node_of(node)

            if tail is not None and tail.type == "generic_name":
                self.generic_arguments([tail], namespace, enclosing)

            return

        if kind == "attribute":
            self.attribute(node, namespace, enclosing)

            return

        if kind == "invocation_expression":
            self.invocation(node)

        if kind in TYPE_NODES:
            self.declare(node, namespace, enclosing)

            return

        name = name_node_of(node)

        for item in node.children:
            if item == name and kind not in ("qualified_name", "alias_qualified_name"):
                continue

            if kind in ANONYMOUS_NAME_PARENTS and item.type == "identifier":
                continue

            if kind in (
                "for_each_statement",
                "foreach_statement",
            ) and item == node.child_by_field_name("left"):
                continue

            self.walk(item, namespace, enclosing)

    def member_access(self, node: Node, namespace: str, enclosing: tuple) -> None:
        generics: list[Node] = []
        segments = self.chain(node, generics)

        if segments:
            self.use(segments, node, namespace, enclosing)
            self.generic_arguments(generics, namespace, enclosing)

            return

        head = node.child_by_field_name("expression")
        tail = name_node_of(node)

        if head is not None:
            self.walk(head, namespace, enclosing)

        if tail is not None and tail.type == "generic_name":
            self.generic_arguments([tail], namespace, enclosing)

    def generic_arguments(self, generics: list[Node], namespace: str, enclosing: tuple) -> None:
        for generic in generics:
            for item in generic.children:
                if item.type == "type_argument_list":
                    self.walk(item, namespace, enclosing)

    def attribute(self, node: Node, namespace: str, enclosing: tuple) -> None:
        name = name_node_of(node)
        generics: list[Node] = []
        segments = self.chain(name, generics) if name is not None else None

        if segments:
            self.use(segments, node, namespace, enclosing)
            self.use([*segments[:-1], segments[-1] + ATTRIBUTE_SUFFIX], node, namespace, enclosing)

        for item in node.children:
            if item != name:
                self.walk(item, namespace, enclosing)

    def invocation(self, node: Node) -> None:
        function = node.child_by_field_name("function")
        name = called_name(function) if function is not None else None

        if name:
            self.file.extension_calls.setdefault(name, line_of(node))


def called_name(node: Node) -> str | None:
    if node.type == "member_access_expression":
        return simple_name(name_node_of(node))

    if node.type == "member_binding_expression":
        return simple_name(name_node_of(node))

    if node.type == "conditional_access_expression" and node.children:
        return called_name(node.children[-1])

    return None


def simple_name(node: Node | None) -> str | None:
    if node is None:
        return None

    if node.type == "generic_name":
        first = child(node, "identifier")

        return text_of(first) if first else None

    return text_of(node) if node.type == "identifier" else None


def read_source(path: str, directory: str, parsed: Parsed) -> SourceFile:
    return Collector(path, directory, parsed).collect()
