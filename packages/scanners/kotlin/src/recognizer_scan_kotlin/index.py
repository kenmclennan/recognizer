import os
from collections.abc import Iterable

from recognizer_scan_kotlin.declarations import Decl, SourceFile


class Index:
    def __init__(self, files: list[SourceFile], build_of: dict[str, str]):
        self.files = files
        self.build_of = build_of
        self.packages: dict[str, dict[str, set[str]]] = {}
        self.top: dict[tuple[str, str], Decl] = {}
        self.kinds: dict[tuple[str, str], set[str]] = {}
        self.expects: dict[tuple[str, str], set[str]] = {}
        self.prefixes: list[str] = []

        for file in files:
            names = self.packages.setdefault(file.package, {})

            for decl in file.decls:
                if decl.owner is None:
                    if decl.visibility != "private":
                        names.setdefault(decl.name, set()).add(file.path)
                        self.kinds.setdefault((file.package, decl.name), set()).add(decl.kind)

                    if decl.is_expect:
                        self.expects.setdefault((file.package, decl.name), set()).add(file.path)

                    self.top.setdefault((file.path, decl.name), decl)

        self.prefixes = self.build_prefixes()

    def build_prefixes(self) -> list[str]:
        by_build: dict[str, list[list[str]]] = {}

        for file in self.files:
            if file.package:
                by_build.setdefault(self.build_of[file.path], []).append(file.package.split("."))

        found = []

        for packages in by_build.values():
            common = os.path.commonprefix(packages)

            if common:
                found.append(".".join(common))

        return sorted(set(found))

    def under_prefix(self, package: str) -> bool:
        return any(package == p or package.startswith(p + ".") for p in self.prefixes)

    def files_for(self, package: str, name: str) -> set[str]:
        return self.packages.get(package, {}).get(name, set())

    def only_functions(self, package: str, name: str) -> bool:
        return self.kinds.get((package, name), set()) == {"function"}

    def expect_files_of(self, file: SourceFile) -> list[str]:
        build = self.build_of[file.path]
        found: set[str] = set()

        for decl in file.decls:
            if decl.owner is None and decl.is_actual:
                found |= {
                    path
                    for path in self.expects.get((file.package, decl.name), set())
                    if path != file.path and self.build_of[path] == build
                }

        return sorted(found)

    def prefer(self, paths: Iterable[str], build: str) -> list[str]:
        found = sorted(paths)
        inside = [d for d in found if self.build_of[d] == build]

        return inside or found

    def kind_of(self, path: str, name: str) -> str | None:
        decl = self.top.get((path, name))

        return decl.kind if decl else None
