from dataclasses import dataclass

from recognizer_scan_python.analysis import Imports, NamedImport

Route = tuple[str, tuple[str, ...]]


@dataclass
class ModuleNames:
    defined: set[str]
    imports: Imports


class Router:
    def __init__(self, names: dict[str, ModuleNames]):
        self._names = names

    def follow(self, module: str, name: str) -> list[Route]:
        routes = self._walk(module, name, (), frozenset({(module, name)}))

        return routes or [(module, ())]

    def _walk(self, module: str, name: str, via: tuple[str, ...], seen: frozenset) -> list[Route]:
        known = self._names[module]

        if name in known.defined:
            return [(module, via)]

        if name in known.imports.reexports:
            source, original = known.imports.reexports[name]

            if (source, original) in seen:
                return [(module, via)]

            return self._walk(source, original, (*via, module), seen | {(source, original)})

        routes = []

        for source in known.imports.stars:
            if (source, name) not in seen:
                routes.extend(self._walk(source, name, (*via, module), seen | {(source, name)}))

        return routes


def named_edges(importer: str, statement: NamedImport, router: Router) -> list[dict]:
    grouped: dict[str, tuple[list[str], list[str]]] = {}

    for name in statement.names:
        if statement.exact:
            routes = router.follow(statement.owner, name)
        else:
            routes = [(statement.owner, ())]

        for target, via in routes:
            if target == importer:
                continue

            names, passed = grouped.setdefault(target, ([], []))

            if name not in names:
                names.append(name)

            passed.extend(step for step in via if step not in passed)

    edges = []

    for target, (names, passed) in grouped.items():
        edge = {"to": target, "line": statement.line, "names": names}

        if passed:
            edge["via"] = passed

        edges.append(edge)

    return edges
