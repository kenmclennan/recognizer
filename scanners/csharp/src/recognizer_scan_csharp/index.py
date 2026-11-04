from recognizer_scan_csharp.declarations import Decl, SourceFile, scopes_of


class Index:
    def __init__(self, files: list[SourceFile]):
        self.files = {f.path: f for f in files}
        self.top: dict[str, dict[str, list[Decl]]] = {}
        self.nested: dict[tuple[str, tuple[str, ...]], dict[str, list[Decl]]] = {}
        self.by_key: dict[tuple[str, tuple[str, ...]], list[Decl]] = {}
        self.extensions: dict[str, list[Decl]] = {}
        self.namespaces: set[str] = set()

        for file in files:
            for namespace in file.namespaces:
                self.namespaces.update(scopes_of(namespace)[:-1])

            for decl in file.decls:
                decl.projects = file.projects
                self.by_key.setdefault(decl.key, []).append(decl)
                self.namespaces.update(scopes_of(decl.namespace)[:-1])

                if decl.outer:
                    holder = self.nested.setdefault((decl.namespace, decl.outer), {})
                    holder.setdefault(decl.name, []).append(decl)
                else:
                    holder = self.top.setdefault(decl.namespace, {})
                    holder.setdefault(decl.name, []).append(decl)

                for name in decl.extension_names:
                    self.extensions.setdefault(name, []).append(decl)

    def declares_namespace(self, namespace: str) -> bool:
        return namespace in self.namespaces

    def top_decls(self, namespace: str, name: str) -> list[Decl]:
        return self.top.get(namespace, {}).get(name, [])

    def nested_decls(self, namespace: str, path: tuple[str, ...], name: str) -> list[Decl]:
        return self.nested.get((namespace, path), {}).get(name, [])

    def abstract_names(self) -> set[str]:
        found = set()

        for decls in self.by_key.values():
            for decl in decls:
                if decl.kind == "interface" or decl.abstract:
                    found.add(decl.name)

        return found
