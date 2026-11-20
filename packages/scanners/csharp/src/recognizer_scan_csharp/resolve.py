from dataclasses import dataclass, field

from recognizer_scan_csharp.declarations import Decl, SourceFile, scopes_of
from recognizer_scan_csharp.index import Index
from recognizer_scan_csharp.projects import Project

MAX_BASE_DEPTH = 3


@dataclass
class Collected:
    depends: dict[tuple[str, str], dict] = field(default_factory=dict)
    others: dict[tuple, dict] = field(default_factory=dict)
    foreign: set[str] = field(default_factory=set)
    unresolved: list[dict] = field(default_factory=list)

    def depend(self, source: str, target: str, line: int, order: int, names=()) -> None:
        entry = self.depends.setdefault((source, target), {"names": set(), "at": (order, line)})
        entry["names"].update(names)
        entry["at"] = min(entry["at"], (order, line))

    def edges(self) -> list[dict]:
        found = []

        for (source, target), entry in self.depends.items():
            edge = {"from": source, "to": target, "kind": "depends", "line": entry["at"][1]}

            if entry["names"]:
                edge["names"] = sorted(entry["names"])

            found.append(edge)

        return found + list(self.others.values())


@dataclass
class Scope:
    namespaces: list[str] = field(default_factory=list)
    statics: list[tuple[str, ...]] = field(default_factory=list)
    aliases: dict[str, tuple[str, ...]] = field(default_factory=dict)


def accessible(file: SourceFile, decl: Decl) -> bool:
    if decl.path == file.path:
        return True

    if decl.visibility in ("public", "protected"):
        return True

    if decl.visibility == "internal":
        return bool(file.projects & decl.projects)

    return False


def reaches(file: SourceFile, decl: Decl) -> bool:
    return decl.path == file.path or bool(file.reach & decl.projects)


def visible(file: SourceFile, decl: Decl) -> bool:
    return accessible(file, decl) and reaches(file, decl)


class Resolver:
    def __init__(self, index: Index, projects: dict[str, Project], globals_of: dict[str, list]):
        self.index = index
        self.projects = projects
        self.globals_of = globals_of
        self.scopes: dict[str, Scope] = {}
        self.base_cache: dict[tuple, list[tuple]] = {}
        self.prefixes = sorted({p.prefix for p in projects.values() if not p.test})

    def scope_of(self, file: SourceFile) -> Scope:
        found = self.scopes.get(file.path)

        if found is not None:
            return found

        scope = Scope()
        usings = list(file.usings)

        for key in sorted(file.projects):
            usings.extend(self.globals_of.get(key, []))
            project = self.projects.get(key)

            if project is None:
                continue

            scope.namespaces.extend(project.implicit_usings)

            for item in project.fragment.usings:
                segments = tuple(item.namespace.split("."))

                if item.alias:
                    scope.aliases.setdefault(item.alias, segments)
                elif item.static:
                    scope.statics.append(segments)
                else:
                    scope.namespaces.append(item.namespace)

        for item in usings:
            if item.kind == "alias" and item.alias:
                scope.aliases[item.alias] = item.segments
            elif item.kind == "static":
                scope.statics.append(item.segments)
            else:
                scope.namespaces.append(item.text)

        scope.namespaces = list(dict.fromkeys(scope.namespaces))
        self.scopes[file.path] = scope

        return scope

    def pick(self, file: SourceFile, decls: list[Decl]) -> list[Decl]:
        seen = [d for d in decls if visible(file, d)]
        inside = [d for d in seen if d.projects & file.projects]

        return inside or seen

    def nested_lookup(self, file: SourceFile, key: tuple, name: str, depth: int = 0) -> list[Decl]:
        found = self.pick(file, self.index.nested_decls(key[0], key[1], name))

        if found or depth >= MAX_BASE_DEPTH:
            return found

        for base in self.base_keys(key):
            found = self.nested_lookup(file, base, name, depth + 1)

            if found:
                return found

        return []

    def base_keys(self, key: tuple) -> list[tuple]:
        if key in self.base_cache:
            return self.base_cache[key]

        self.base_cache[key] = []
        found = []

        for part in self.index.by_key.get(key, []):
            owner = self.index.files[part.path]

            for segments in part.bases:
                for target in self.chain(owner, list(segments), part.outer, part.namespace):
                    if target.key != key and target.key not in found:
                        found.append(target.key)

        self.base_cache[key] = found

        return found

    def simple(self, file: SourceFile, name: str, enclosing: tuple, namespace: str) -> list[Decl]:
        for size in range(len(enclosing), 0, -1):
            found = self.nested_lookup(file, (namespace, enclosing[:size]), name)

            if found:
                return found

        for scope in scopes_of(namespace):
            found = self.pick(file, self.index.top_decls(scope, name))

            if found:
                return found

        scope = self.scope_of(file)
        alias = scope.aliases.get(name)

        if alias:
            return self.qualified(file, list(alias), namespace)

        found = []

        for used in scope.namespaces:
            found.extend(self.pick(file, self.index.top_decls(used, name)))

        return list(dict.fromkeys(found))

    def qualified(self, file: SourceFile, segments: list[str], namespace: str) -> list[Decl]:
        roots = scopes_of(namespace) + self.scope_of(file).namespaces

        for size in range(len(segments) - 1, 0, -1):
            prefix = ".".join(segments[:size])

            for root in roots:
                full = f"{root}.{prefix}" if root else prefix
                found = self.pick(file, self.index.top_decls(full, segments[size]))

                if found:
                    return found

        return []

    def chain(
        self, file: SourceFile, segments: list[str], enclosing: tuple, namespace: str
    ) -> list[Decl]:
        scope = self.scope_of(file)
        alias = scope.aliases.get(segments[0])

        if alias:
            return self.qualified(file, [*alias, *segments[1:]], namespace) or (
                self.qualified(file, list(alias), namespace) if len(segments) == 1 else []
            )

        if len(segments) > 1:
            found = self.qualified(file, segments, namespace)

            if found:
                return found

        return self.simple(file, segments[0], enclosing, namespace)

    def static_targets(self, file: SourceFile) -> list[Decl]:
        found = []

        for segments in self.scope_of(file).statics:
            found.extend(self.qualified(file, list(segments), ""))

        return found

    def under_prefix(self, namespace: str) -> bool:
        return any(namespace == p or namespace.startswith(p + ".") for p in self.prefixes)

    def resolve_file(self, file: SourceFile, order: int, collected: Collected) -> None:
        statics = self.static_targets(file)
        unresolved_names = set()

        for (segments, enclosing, namespace), line in sorted(
            file.uses.items(), key=lambda item: (item[1], item[0])
        ):
            targets = self.chain(file, list(segments), enclosing, namespace)

            for target in targets:
                if target.path != file.path:
                    collected.depend(file.path, target.path, line, order, [target.name])

            if targets:
                continue

            matched = False

            for target in statics if len(segments) == 1 else []:
                if segments[0] in target.member_names and target.path != file.path:
                    collected.depend(file.path, target.path, line, order, [segments[0]])
                    matched = True

            head = segments[0]

            if (
                not matched
                and head[:1].isupper()
                and len(head) > 1
                and head not in file.declared_names
            ):
                unresolved_names.add(head)

        self.supertype_edges(file, collected)
        self.using_edges(file, order, collected, bool(unresolved_names))

    def supertype_edges(self, file: SourceFile, collected: Collected) -> None:
        for decl in file.decls:
            if decl.outer:
                continue

            for segments in decl.bases:
                for target in self.chain(file, list(segments), (), decl.namespace):
                    if target.path == file.path or target.outer:
                        continue

                    kind = (
                        "implements"
                        if decl.kind == "class" and target.kind == "interface"
                        else "inherits"
                    )
                    edge = {
                        "from": file.path,
                        "to": target.path,
                        "kind": kind,
                        "line": decl.line,
                        "member": decl.name,
                        "to_member": target.name,
                    }
                    collected.others[(file.path, target.path, kind, decl.name, target.name)] = edge

    def using_edges(
        self, file: SourceFile, order: int, collected: Collected, has_unresolved: bool
    ) -> None:
        for item in file.usings:
            if item.kind != "plain":
                continue

            namespace = item.text

            if self.under_prefix(namespace):
                if not self.index.declares_namespace(namespace):
                    collected.unresolved.append(
                        {"from": file.path, "import": namespace, "line": item.line}
                    )
            elif has_unresolved:
                collected.foreign.add(namespace)
                collected.depend(file.path, f"foreign:{namespace}", item.line, order)
