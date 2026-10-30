from dataclasses import dataclass, field

from tree_sitter import Node

from recognizer_scan_kotlin.declarations import (
    Decl,
    SourceFile,
    child,
    class_body,
    line_of,
    name_of,
    property_name,
    text_of,
    type_node,
    type_segments,
    walk,
)
from recognizer_scan_kotlin.index import Index
from recognizer_scan_kotlin.outline import methods_of
from recognizer_scan_kotlin.resolve import Resolver

Key = tuple[str, str]


@dataclass
class ClassInfo:
    key: Key
    decl: Decl
    file: SourceFile
    methods: dict[str, dict]
    property_types: dict[str, list[str]] = field(default_factory=dict)


def property_types_of(node: Node) -> dict[str, list[str]]:
    found = {}
    constructor = child(node, "primary_constructor")
    parameters = child(constructor, "class_parameters") if constructor else None

    for item in parameters.children if parameters else []:
        if item.type == "class_parameter" and child(item, "val", "var"):
            segments = type_segments(type_node(item))

            if segments:
                found[name_of(item) or ""] = segments

    body = class_body(node)

    for item in body.children if body else []:
        declaration = (
            child(item, "variable_declaration") if item.type == "property_declaration" else None
        )
        segments = type_segments(type_node(declaration)) if declaration is not None else None

        if segments:
            found[property_name(item) or ""] = segments

    return found


def parameter_types_of(function: Node) -> dict[str, list[str]]:
    holder = child(function, "function_value_parameters")
    found = {}

    for item in holder.children if holder else []:
        segments = type_segments(type_node(item)) if item.type == "parameter" else None

        if segments:
            found[name_of(item) or ""] = segments

    return found


class CallResolver:
    def __init__(
        self, files: list[SourceFile], index: Index, resolver: Resolver, endpoints: set[str]
    ):
        self.files = files
        self.index = index
        self.resolver = resolver
        self.endpoints = endpoints
        self.classes: dict[Key, ClassInfo] = {}
        self.companions: dict[Key, list[Key]] = {}
        self.found: set[tuple[str, int, str, str]] = set()

        for file in files:
            for decl in file.decls:
                if decl.node is None or decl.kind not in ("class", "interface"):
                    continue

                key = (file.directory, decl.name)
                methods = {
                    m["name"]: m for m in methods_of(decl.node, decl.kind == "interface", False)
                }
                self.classes[key] = ClassInfo(
                    key, decl, file, methods, property_types_of(decl.node)
                )

                if decl.owner:
                    self.companions.setdefault((file.directory, decl.owner), []).append(key)

        self.supers = {key: self.super_keys(info) for key, info in self.classes.items()}

    def super_keys(self, info: ClassInfo) -> list[Key]:
        found = []

        for segments in info.decl.supertypes:
            for target in self.resolver.resolve_segments(info.file, segments):
                if target in self.classes and target not in found:
                    found.append(target)

        return found

    def find_method(self, key: Key, name: str, seen: set[Key] | None = None) -> Key | None:
        seen = seen if seen is not None else set()

        if key in seen or key not in self.classes:
            return None

        seen.add(key)

        if name in self.classes[key].methods:
            return key

        for parent in self.supers[key]:
            found = self.find_method(parent, name, seen)

            if found:
                return found

        return None

    def has_unscanned_super(self, key: Key, seen: set[Key] | None = None) -> bool:
        seen = seen if seen is not None else set()

        if key in seen or key not in self.classes:
            return False

        seen.add(key)
        info = self.classes[key]

        if len(self.supers[key]) < len(info.decl.supertypes):
            return True

        return any(self.has_unscanned_super(parent, seen) for parent in self.supers[key])

    def record(self, source: str, line: int, target: str, how: str) -> None:
        self.found.add((source, line, target, how))

    def method_ref(self, key: Key, name: str) -> str:
        return f"{key[0]}::{key[1]}.{name}"

    def call_through(
        self, file: SourceFile, segments: list[str], method: str, source: str, line: int
    ) -> None:
        for directory, top in self.resolver.resolve_segments(file, segments):
            owner = self.find_method((directory, top), method)

            if owner:
                self.record(source, line, self.method_ref(owner, method), "call")
            elif self.index.kind_of(directory, top) == "interface" and self.has_unscanned_super(
                (directory, top)
            ):
                self.record(source, line, f"{directory}::{top}", "call")

    def call_on_name(
        self, file: SourceFile, name: str, method: str, source: str, line: int
    ) -> None:
        for directory, top in self.resolver.resolve_name(file, name):
            decl = self.index.top.get((directory, top))

            if decl is None:
                continue

            keys = [(directory, top)] if decl.is_object else []
            keys += self.companions.get((directory, top), [])

            for key in keys:
                owner = self.find_method(key, method)

                if owner:
                    self.record(source, line, self.method_ref(owner, method), "call")

    def call_by_name(
        self, file: SourceFile, info: ClassInfo | None, name: str, source: str, line: int
    ) -> None:
        if info:
            owner = self.find_method(info.key, name)

            if owner:
                self.record(source, line, self.method_ref(owner, name), "call")

                return

        for directory, top in self.resolver.resolve_name(file, name):
            decl = self.index.top.get((directory, top))

            if decl is None:
                continue

            if decl.kind == "function":
                self.record(source, line, f"{directory}::{top}", "call")
            elif decl.kind == "class" and not decl.is_object:
                self.record(source, line, f"{directory}::{top}", "construct")

    def calls_in(
        self, file: SourceFile, info: ClassInfo | None, function: Node, source: str
    ) -> None:
        body = child(function, "function_body")

        if body is None:
            return

        local = parameter_types_of(function)

        for node in walk(body):
            if node.type != "call_expression" or not node.children:
                continue

            callee = node.children[0]
            line = line_of(callee)

            if callee.type == "identifier":
                self.call_by_name(file, info, text_of(callee), source, line)
            elif callee.type == "navigation_expression" and len(callee.children) >= 3:
                left, right = callee.children[0], callee.children[-1]

                if left.type != "identifier" or right.type != "identifier":
                    continue

                receiver = text_of(left)
                method = text_of(right)
                declared = local.get(receiver) or (
                    info.property_types.get(receiver) if info else None
                )

                if declared:
                    self.call_through(file, declared, method, source, line)
                else:
                    self.call_on_name(file, receiver, method, source, line)

    def scan_file(self, file: SourceFile) -> None:
        for decl in file.decls:
            if decl.node is None:
                continue

            module = file.directory

            if decl.kind == "function":
                self.calls_in(file, None, decl.node, f"{module}::{decl.name}")
            elif decl.kind in ("class", "interface"):
                info = self.classes[(module, decl.name)]
                body = class_body(decl.node)

                for item in body.children if body else []:
                    if item.type == "function_declaration":
                        source = f"{module}::{decl.name}.{name_of(item)}"
                        self.calls_in(file, info, item, source)

    def subclasses(self, key: Key) -> list[Key]:
        found = []
        pending = [key]

        while pending:
            current = pending.pop()

            for other, parents in self.supers.items():
                if current in parents and other not in found:
                    found.append(other)
                    pending.append(other)

        return found

    def add_dispatch(self) -> None:
        for key, info in self.classes.items():
            for name, method in info.methods.items():
                if "abstract" not in method.get("tags", []):
                    continue

                for sub in self.subclasses(key):
                    concrete = self.classes[sub].methods.get(name)

                    if concrete and "abstract" not in concrete.get("tags", []):
                        self.record(
                            self.method_ref(key, name),
                            method["line"],
                            self.method_ref(sub, name),
                            "dispatch",
                        )

    def scan_calls(self) -> list[dict]:
        for file in self.files:
            self.scan_file(file)

        self.add_dispatch()

        calls = [
            {"from": source, "to": target, "line": line, "how": how}
            for source, line, target, how in self.found
            if source in self.endpoints and target in self.endpoints and source != target
        ]

        return sorted(calls, key=lambda c: (c["from"], c["line"], c["to"], c["how"]))
