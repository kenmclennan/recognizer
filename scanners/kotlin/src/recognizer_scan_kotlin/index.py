import os
from collections.abc import Iterable

from recognizer_scan_kotlin.declarations import Decl, SourceFile


class Index:
    def __init__(self, files: list[SourceFile], build_of: dict[str, str]):
        self.files = files
        self.build_of = build_of
        self.packages: dict[str, dict[str, set[str]]] = {}
        self.top: dict[tuple[str, str], Decl] = {}
        self.prefixes: list[str] = []

        for file in files:
            names = self.packages.setdefault(file.package, {})

            for decl in file.decls:
                if decl.owner is None:
                    names.setdefault(decl.name, set()).add(file.directory)
                    self.top.setdefault((file.directory, decl.name), decl)

        self.prefixes = self.build_prefixes()

    def build_prefixes(self) -> list[str]:
        by_build: dict[str, list[list[str]]] = {}

        for file in self.files:
            if file.package:
                by_build.setdefault(self.build_of[file.directory], []).append(
                    file.package.split(".")
                )

        found = []

        for packages in by_build.values():
            common = os.path.commonprefix(packages)

            if common:
                found.append(".".join(common))

        return sorted(set(found))

    def under_prefix(self, package: str) -> bool:
        return any(package == p or package.startswith(p + ".") for p in self.prefixes)

    def dirs_for(self, package: str, name: str) -> set[str]:
        return self.packages.get(package, {}).get(name, set())

    def prefer(self, directories: Iterable[str], build: str) -> list[str]:
        found = sorted(directories)
        inside = [d for d in found if self.build_of[d] == build]

        return inside or found

    def kind_of(self, directory: str, name: str) -> str | None:
        decl = self.top.get((directory, name))

        return decl.kind if decl else None
