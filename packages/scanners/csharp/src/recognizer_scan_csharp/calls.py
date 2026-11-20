import re

from tree_sitter import Node

from recognizer_scan_csharp.declarations import (
    Decl,
    SourceFile,
    called_name,
    line_of,
    name_node_of,
    text_of,
)
from recognizer_scan_csharp.extensions import visible_namespaces
from recognizer_scan_csharp.index import Index
from recognizer_scan_csharp.outline import fields_of, method_items, method_of
from recognizer_scan_csharp.resolve import Resolver, accessible, reaches

IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
GENERIC_ARGUMENTS = re.compile(r"<[^<>]*>")
MAX_BASE_DEPTH = 8

Found = set[tuple[str, int, str, str]]


def segments_of_type(text: str) -> list[str] | None:
    cleaned = text.strip().removeprefix("global::")

    while GENERIC_ARGUMENTS.search(cleaned):
        cleaned = GENERIC_ARGUMENTS.sub("", cleaned)

    cleaned = cleaned.removesuffix("?").replace(" ", "")
    parts = cleaned.split(".")

    if not cleaned or not all(IDENTIFIER.fullmatch(p) for p in parts):
        return None

    return parts


def segments_of_expression(node: Node) -> list[str] | None:
    if node.type == "identifier":
        return [text_of(node)]

    if node.type == "member_access_expression":
        head = node.child_by_field_name("expression")
        tail = name_node_of(node)

        if head is None or tail is None or tail.type != "identifier":
            return None

        left = segments_of_expression(head)

        return left + [text_of(tail)] if left else None

    return None


def receiver_name(node: Node) -> str | None:
    if node.type == "identifier":
        return text_of(node)

    if node.type == "member_access_expression":
        head = node.child_by_field_name("expression")
        tail = name_node_of(node)

        if head is not None and head.type == "this" and tail is not None:
            return text_of(tail) if tail.type == "identifier" else None

    return None


def invocations_in(root: Node):
    stack = [root]

    while stack:
        node = stack.pop()

        if node.type == "invocation_expression":
            yield node

        stack.extend(reversed(node.children))


def call_site(invocation: Node) -> tuple[Node, str, int] | None:
    function = invocation.child_by_field_name("function")

    if function is None:
        return None

    if function.type == "member_access_expression":
        receiver = function.child_by_field_name("expression")
        tail = name_node_of(function)
    elif function.type == "conditional_access_expression" and len(function.children) >= 3:
        binding = function.children[-1]

        if binding.type != "member_binding_expression":
            return None

        receiver = function.children[0]
        tail = name_node_of(binding)
    else:
        return None

    name = called_name(function)

    if receiver is None or tail is None or not name:
        return None

    return receiver, name, line_of(tail)


class Calls:
    def __init__(self, files: list[SourceFile], index: Index, resolver: Resolver):
        self.files = files
        self.index = index
        self.resolver = resolver
        self.methods: dict[Decl, dict[str, list[dict]]] = {}
        self.fields: dict[Decl, list[dict]] = {}
        self.endpoints: set[str] = set()
        self.found: Found = set()
        self.namespaces: dict[str, set[str]] = {}

        for file in files:
            for decl in file.decls:
                if decl.outer:
                    continue

                self.endpoints.add(ref(decl))
                self.index_decl(decl)

        for file in files:
            for decl in file.decls:
                if decl not in self.methods:
                    self.index_decl(decl)

    def index_decl(self, decl: Decl) -> None:
        table: dict[str, list[dict]] = {}

        for item in method_items(decl):
            method = method_of(item, decl)
            table.setdefault(method["name"], []).append(method)

            if not decl.outer:
                self.endpoints.add(ref(decl, method["name"]))

        self.methods[decl] = table
        self.fields[decl] = fields_of(decl)

    def record(self, source: str, line: int, target: str, how: str) -> None:
        self.found.add((source, line, target, how))

    def declared_type(self, decl: Decl, method: dict, name: str) -> tuple[str, Decl] | None:
        for parameter in method["params"]:
            if parameter["name"] == name:
                return parameter.get("type", ""), decl

        for part in self.index.by_key.get(decl.key, [decl]):
            for item in self.fields[part]:
                if item["name"] == name:
                    return item.get("type", ""), part

        return None

    def types_of(self, part: Decl, segments: list[str]) -> list[Decl]:
        owner = self.index.files[part.path]
        enclosing = part.outer + (part.name,)

        return self.resolver.chain(owner, segments, enclosing, part.namespace)

    def holders(
        self, key: tuple, name: str, seen: set | None = None, depth: int = 0
    ) -> tuple[list[Decl], bool]:
        seen = seen if seen is not None else set()

        if key in seen or depth > MAX_BASE_DEPTH:
            return [], False

        seen.add(key)
        parts = self.index.by_key.get(key, [])
        found = [p for p in parts if name in self.methods.get(p, {})]

        if found:
            return found, False

        unresolved = any(
            not self.types_of(p, list(segments)) for p in parts for segments in p.bases
        )

        for base in self.resolver.base_keys(key):
            inherited, base_unresolved = self.holders(base, name, seen, depth + 1)

            if inherited:
                return inherited, False

            unresolved = unresolved or base_unresolved

        return [], unresolved

    def instance_targets(self, part: Decl, text: str, name: str) -> tuple[list[str], bool]:
        segments = segments_of_type(text)

        if segments is None:
            return [], False

        types = self.types_of(part, segments)

        if not types:
            return [], False

        keys = list(dict.fromkeys(t.key for t in types))
        targets: list[str] = []
        blocked = False

        for key in keys:
            holders, unresolved = self.holders(key, name)
            blocked = blocked or unresolved
            targets.extend(ref(h, name) for h in holders)

        return list(dict.fromkeys(targets)), (bool(targets) or blocked)

    def static_targets(self, decl: Decl, segments: list[str], name: str) -> list[str]:
        owner = self.index.files[decl.path]
        types = self.resolver.chain(owner, segments, decl.outer + (decl.name,), decl.namespace)
        targets = []

        for found in types:
            for method in self.methods.get(found, {}).get(name, []):
                if "static" in method.get("tags", []):
                    targets.append(ref(found, name))

        return list(dict.fromkeys(targets))

    def extension_targets(self, file: SourceFile, name: str) -> list[str]:
        namespaces = self.namespaces.get(file.path)

        if namespaces is None:
            namespaces = visible_namespaces(file, self.resolver)
            self.namespaces[file.path] = namespaces

        targets = []

        for decl in self.index.extensions.get(name, []):
            if (
                decl.path != file.path
                and decl.namespace in namespaces
                and accessible(file, decl)
                and reaches(file, decl)
            ):
                targets.append(ref(decl, name))

        return targets

    def targets_of(
        self, file: SourceFile, decl: Decl, method: dict, receiver: Node, name: str
    ) -> list[str]:
        local = receiver_name(receiver)
        declared = self.declared_type(decl, method, local) if local else None

        if declared is not None:
            text, part = declared
            targets, blocked = self.instance_targets(part, text, name)

            if targets or blocked:
                return targets
        elif receiver.type in ("identifier", "member_access_expression"):
            segments = segments_of_expression(receiver)
            targets = self.static_targets(decl, segments, name) if segments else []

            if targets:
                return targets

        return self.extension_targets(file, name)

    def calls_in(self, file: SourceFile, decl: Decl) -> None:
        for item in method_items(decl):
            method = method_of(item, decl)
            source = ref(decl, method["name"])

            for invocation in invocations_in(item):
                site = call_site(invocation)

                if site is None:
                    continue

                receiver, name, line = site

                for target in self.targets_of(file, decl, method, receiver, name):
                    self.record(source, line, target, "call")

    def subtypes(self, key: tuple) -> list[tuple]:
        found: list[tuple] = []
        pending = [key]

        while pending:
            current = pending.pop()

            for other in self.supers:
                if current in self.supers[other] and other not in found and other != key:
                    found.append(other)
                    pending.append(other)

        return found

    def add_dispatch(self) -> None:
        self.supers = {key: self.resolver.base_keys(key) for key in self.index.by_key}

        for key, parts in self.index.by_key.items():
            for part in parts:
                if part.outer:
                    continue

                for name, overloads in self.methods[part].items():
                    abstract = [m for m in overloads if "abstract" in m.get("tags", [])]

                    if not abstract:
                        continue

                    self.dispatch_from(key, part, name, abstract[0]["line"])

    def dispatch_from(self, key: tuple, part: Decl, name: str, line: int) -> None:
        for sub in self.subtypes(key):
            for concrete in self.index.by_key.get(sub, []):
                overloads = self.methods.get(concrete, {}).get(name, [])

                if any("abstract" not in m.get("tags", []) for m in overloads):
                    self.record(ref(part, name), line, ref(concrete, name), "dispatch")

    def scan_calls(self) -> list[dict]:
        for file in self.files:
            for decl in file.decls:
                if not decl.outer:
                    self.calls_in(file, decl)

        self.add_dispatch()

        calls = [
            {"from": source, "to": target, "line": line, "how": how}
            for source, line, target, how in self.found
            if source in self.endpoints and target in self.endpoints and source != target
        ]

        return sorted(calls, key=lambda c: (c["from"], c["line"], c["to"], c["how"]))


def ref(decl: Decl, method: str | None = None) -> str:
    base = f"{decl.path}::{'.'.join(decl.outer + (decl.name,))}"

    return f"{base}.{method}" if method else base


def resolve_calls(files: list[SourceFile], index: Index, resolver: Resolver) -> list[dict]:
    return Calls(files, index, resolver).scan_calls()
