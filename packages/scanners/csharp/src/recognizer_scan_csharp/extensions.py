from recognizer_scan_csharp.declarations import SourceFile, scopes_of
from recognizer_scan_csharp.resolve import Collected, Resolver, accessible, reaches


def visible_namespaces(file: SourceFile, resolver: Resolver) -> set[str]:
    found = set(resolver.scope_of(file).namespaces)

    for namespace in file.namespaces | {""}:
        found.update(scopes_of(namespace))

    return found


def extension_edges(file: SourceFile, resolver: Resolver, order: int, collected: Collected) -> None:
    namespaces = visible_namespaces(file, resolver)

    for name, line in sorted(file.extension_calls.items()):
        for decl in resolver.index.extensions.get(name, []):
            if (
                decl.path != file.path
                and decl.namespace in namespaces
                and accessible(file, decl)
                and reaches(file, decl)
            ):
                collected.depend(file.path, decl.path, line, order, [name])
