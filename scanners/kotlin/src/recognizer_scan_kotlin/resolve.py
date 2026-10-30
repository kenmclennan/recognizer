from dataclasses import dataclass, field

from recognizer_scan_kotlin.declarations import Import, SourceFile
from recognizer_scan_kotlin.index import Index


def split_import(path: tuple[str, ...], wildcard: bool) -> tuple[str, list[str]]:
    capital = next((i for i, segment in enumerate(path) if segment[:1].isupper()), None)

    if capital is None:
        if wildcard:
            return ".".join(path), []

        return ".".join(path[:-1]), list(path[-1:])

    return ".".join(path[:capital]), list(path[capital:])


def split_qualified(segments: list[str]) -> tuple[str, str] | None:
    capital = next((i for i, segment in enumerate(segments) if segment[:1].isupper()), None)

    if not capital:
        return None

    return ".".join(segments[:capital]), segments[capital]


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


class Resolver:
    def __init__(self, index: Index):
        self.index = index

    def import_targets(self, file: SourceFile, package: str, rest: list[str]) -> list[str]:
        if not rest:
            return []

        directories = self.index.dirs_for(package, rest[0])

        if file.directory in directories:
            return [file.directory]

        return self.index.prefer(directories, self.index.build_of[file.directory])

    def resolve_name(self, file: SourceFile, name: str) -> list[tuple[str, str]]:
        for imp in file.imports:
            if not imp.wildcard and imp.binding == name:
                package, rest = split_import(imp.path, False)

                return [(d, rest[0]) for d in self.import_targets(file, package, rest)]

        build = self.index.build_of[file.directory]
        own = self.index.dirs_for(file.package, name)

        if own:
            if file.directory in own:
                return [(file.directory, name)]

            return [(d, name) for d in self.index.prefer(own, build)]

        for imp in file.imports:
            if not imp.wildcard:
                continue

            package, rest = split_import(imp.path, True)

            if not rest:
                directories = self.index.dirs_for(package, name)

                if directories:
                    return [(d, name) for d in self.index.prefer(directories, build)]
            else:
                top = rest[0]

                for directory in self.index.prefer(self.index.dirs_for(package, top), build):
                    decl = self.index.top[(directory, top)]

                    if name in decl.members:
                        return [(directory, top)]

        return []

    def resolve_segments(self, file: SourceFile, segments: list[str]) -> list[tuple[str, str]]:
        if len(segments) == 1:
            return self.resolve_name(file, segments[0])

        found = split_qualified(segments)

        if found is None:
            return []

        package, top = found
        directories = self.index.dirs_for(package, top)

        if not directories:
            return []

        return [
            (d, top) for d in self.index.prefer(directories, self.index.build_of[file.directory])
        ]

    def foreign_name(self, imp: Import) -> str:
        package, _ = split_import(imp.path, imp.wildcard)

        return package or ".".join(imp.path)

    def foreign(self, file: SourceFile, imp: Import, collected: Collected, order: int) -> None:
        package = self.foreign_name(imp)
        collected.foreign.add(package)
        collected.depend(file.directory, f"foreign:{package}", imp.line, order)

    def note_unresolved(self, file: SourceFile, imp: Import, collected: Collected) -> None:
        package, _ = split_import(imp.path, imp.wildcard)

        if self.index.under_prefix(package):
            collected.unresolved.append(
                {"from": file.directory, "import": imp.text, "line": imp.line}
            )

    def explicit_imports(self, file: SourceFile, collected: Collected, order: int) -> set[str]:
        bindings = set()

        for imp in file.imports:
            if imp.wildcard:
                continue

            bindings.add(imp.binding)
            package, rest = split_import(imp.path, False)
            targets = self.import_targets(file, package, rest)
            used = imp.binding in file.uses

            if targets:
                if used:
                    for target in targets:
                        if target != file.directory:
                            collected.depend(
                                file.directory, target, imp.line, order, [".".join(rest)]
                            )

                continue

            if used:
                self.foreign(file, imp, collected, order)

            self.note_unresolved(file, imp, collected)

        return bindings

    def wildcard_imports(
        self, file: SourceFile, bindings: set[str], collected: Collected, order: int
    ) -> None:
        build = self.index.build_of[file.directory]
        own = self.index.packages.get(file.package, {})

        for imp in file.imports:
            if not imp.wildcard:
                continue

            package, rest = split_import(imp.path, True)

            if not rest:
                names = self.index.packages.get(package)

                if names is None:
                    self.foreign(file, imp, collected, order)
                    self.note_unresolved(file, imp, collected)

                    continue

                for name in sorted(file.uses):
                    if name in bindings or name in own or name not in names:
                        continue

                    for target in self.index.prefer(names[name], build):
                        collected.depend(file.directory, target, imp.line, order, [name])

                continue

            directories = self.index.dirs_for(package, rest[0])

            if not directories:
                self.foreign(file, imp, collected, order)
                self.note_unresolved(file, imp, collected)

                continue

            for target in self.index.prefer(directories, build):
                if target == file.directory:
                    continue

                members = self.index.top[(target, rest[0])].members
                used = [f"{rest[0]}.{u}" for u in sorted(file.uses) if u in members]

                if used:
                    collected.depend(file.directory, target, imp.line, order, used)

    def same_package(
        self, file: SourceFile, bindings: set[str], collected: Collected, order: int
    ) -> None:
        names = self.index.packages.get(file.package, {})
        build = self.index.build_of[file.directory]

        for name, line in sorted(file.uses.items()):
            if name in bindings or name not in names or file.directory in names[name]:
                continue

            for target in self.index.prefer(names[name], build):
                collected.depend(file.directory, target, line, order, [name])

    def qualified_uses(self, file: SourceFile, collected: Collected, order: int) -> None:
        for line, segments in file.chains:
            found = split_qualified(segments)

            if found is None:
                continue

            package, top = found
            directories = self.index.dirs_for(package, top)

            if not directories or file.directory in directories:
                continue

            for target in self.index.prefer(directories, self.index.build_of[file.directory]):
                collected.depend(file.directory, target, line, order, [top])

    def supertype_edges(self, file: SourceFile, collected: Collected) -> None:
        for decl in file.decls:
            if (
                decl.owner is not None
                or decl.node is None
                or decl.kind not in ("class", "interface")
            ):
                continue

            for segments in decl.supertypes:
                for directory, top in self.resolve_segments(file, segments):
                    target = self.index.kind_of(directory, top)

                    if directory == file.directory or target not in ("class", "interface"):
                        continue

                    kind = (
                        "implements"
                        if decl.kind == "class" and target == "interface"
                        else "inherits"
                    )
                    edge = {
                        "from": file.directory,
                        "to": directory,
                        "kind": kind,
                        "line": decl.line,
                        "member": decl.name,
                        "to_member": top,
                    }
                    collected.others[(file.directory, directory, kind, decl.name, top)] = edge

    def resolve_file(self, file: SourceFile, order: int, collected: Collected) -> None:
        bindings = self.explicit_imports(file, collected, order)
        self.wildcard_imports(file, bindings, collected, order)
        self.same_package(file, bindings, collected, order)
        self.qualified_uses(file, collected, order)
        self.supertype_edges(file, collected)
