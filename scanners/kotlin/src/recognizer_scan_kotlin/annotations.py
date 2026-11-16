from tree_sitter import Node

from recognizer_scan_kotlin.declarations import SourceFile, child, segments_of

ENTRY_ANNOTATIONS = frozenset(
    {
        "Controller",
        "Singleton",
        "Prototype",
        "Factory",
        "Filter",
        "ServerFilter",
        "Endpoint",
        "ConfigurationProperties",
        "Context",
        "Requires",
        "OpenAPIDefinition",
        "Component",
        "Service",
        "Repository",
        "RestController",
        "Configuration",
        "Bean",
        "Inject",
        "Named",
    }
)
TYPE_KINDS = ("class", "interface")


def annotation_name(annotation: Node) -> str | None:
    holder = child(annotation, "user_type")

    if holder is None:
        invocation = child(annotation, "constructor_invocation")
        holder = child(invocation, "user_type") if invocation is not None else None

    segments = segments_of(holder) if holder is not None else []

    return segments[-1] if segments else None


def annotations_of(file: SourceFile) -> list[str]:
    names = set()

    for decl in file.decls:
        if decl.owner is not None or decl.kind not in TYPE_KINDS or decl.node is None:
            continue

        modifiers = child(decl.node, "modifiers")

        for item in modifiers.children if modifiers is not None else []:
            name = annotation_name(item) if item.type == "annotation" else None

            if name:
                names.add(name)

    return sorted(names)
