import ast
from dataclasses import dataclass, field

from recognizer_scan_python.analysis import expand, is_abstraction
from recognizer_scan_python.index import ModuleIndex
from recognizer_scan_python.routes import Router

GENERIC_METHODS = frozenset(
    """
    get set has add delete remove pop push append extend insert clear copy update
    keys values items entries close open read write run call apply start stop join
    split map filter forEach reduce find includes indexOf slice then catch finally
    toString toJSON format strip count index sort reverse encode decode load dump
    loads dumps send emit on off
    """.split()
)

MAX_CLASSES = 4

ClassKey = tuple[str, str]


@dataclass
class ClassInfo:
    module_id: str
    name: str
    abstract: bool
    methods: set[str]
    bases: list[ClassKey] = field(default_factory=list)


def function_nodes(body: list[ast.stmt]) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    return [s for s in body if isinstance(s, ast.FunctionDef | ast.AsyncFunctionDef)]


def resolve_base(
    node: ast.expr,
    module_id: str,
    local: set[str],
    bindings: dict[str, str],
    index: ModuleIndex,
    router: Router,
) -> ClassKey | None:
    if isinstance(node, ast.Name) and node.id in local:
        return (module_id, node.id)

    path = expand(node, bindings)

    if not path or len(path) < 2:
        return None

    hit = index.longest(path)

    if hit is None or hit.length != len(path) - 1:
        return None

    module, _ = router.follow(hit.module_id, path[-1])[0]

    return (module, path[-1])


def collect_classes(parsed: dict, index: ModuleIndex, router: Router) -> dict[ClassKey, ClassInfo]:
    classes = {}

    for module_id, item in parsed.items():
        for node in item.tree.body:
            if isinstance(node, ast.ClassDef):
                classes[(module_id, node.name)] = ClassInfo(
                    module_id,
                    node.name,
                    is_abstraction(node, item.imports.bindings),
                    {f.name for f in function_nodes(node.body)},
                )

    for module_id, item in parsed.items():
        local = {name for (owner, name) in classes if owner == module_id}

        for node in item.tree.body:
            if not isinstance(node, ast.ClassDef):
                continue

            for base in node.bases:
                key = resolve_base(base, module_id, local, item.imports.bindings, index, router)

                if key in classes:
                    classes[(module_id, node.name)].bases.append(key)

    return classes


def all_methods(key: ClassKey, classes: dict[ClassKey, ClassInfo], seen: set) -> set[str]:
    if key in seen:
        return set()

    seen.add(key)
    info = classes[key]
    methods = set(info.methods)

    for base in info.bases:
        methods |= all_methods(base, classes, seen)

    return methods


def called_on(body: list[ast.AST], holder) -> set[str]:
    methods = set()

    for statement in body:
        for node in ast.walk(statement):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and holder(node.func.value)
            ):
                methods.add(node.func.attr)

    return methods


def is_name(name: str):
    return lambda node: isinstance(node, ast.Name) and node.id == name


def is_self_attribute(attribute: str):
    return lambda node: (
        isinstance(node, ast.Attribute)
        and node.attr == attribute
        and isinstance(node.value, ast.Name)
        and node.value.id == "self"
    )


def stored_attributes(function, parameter: str) -> set[str]:
    attributes = set()

    for node in ast.walk(function):
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        else:
            continue

        if not is_name(parameter)(value):
            continue

        for target in targets:
            if (
                isinstance(target, ast.Attribute)
                and isinstance(target.value, ast.Name)
                and target.value.id == "self"
            ):
                attributes.add(target.attr)

    return attributes


def untyped_parameters(function, is_method: bool) -> list[ast.arg]:
    positional = [*function.args.posonlyargs, *function.args.args]
    static = any(
        isinstance(d, ast.Name) and d.id == "staticmethod" for d in function.decorator_list
    )

    if is_method and not static:
        positional = positional[1:]

    return [a for a in [*positional, *function.args.kwonlyargs] if a.annotation is None]


def parameter_usages(tree: ast.Module):
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            for parameter in untyped_parameters(node, False):
                yield parameter, called_on(node.body, is_name(parameter.arg))

        if not isinstance(node, ast.ClassDef):
            continue

        methods = function_nodes(node.body)

        for function in methods:
            for parameter in untyped_parameters(function, True):
                called = called_on(function.body, is_name(parameter.arg))

                for attribute in stored_attributes(function, parameter.arg):
                    for method in methods:
                        called |= called_on(method.body, is_self_attribute(attribute))

                yield parameter, called


def matching_classes(called: set[str], classes: dict[ClassKey, ClassInfo]) -> list[ClassInfo]:
    matches = [info for key, info in classes.items() if called <= all_methods(key, classes, set())]
    abstract = [info for info in matches if info.abstract]

    return abstract or matches


def inferred_edges(
    module_id: str, tree: ast.Module, classes: dict[ClassKey, ClassInfo]
) -> list[dict]:
    edges = []

    for parameter, called in parameter_usages(tree):
        if not called or called <= GENERIC_METHODS:
            continue

        kept = matching_classes(called, classes)

        if len(kept) > MAX_CLASSES:
            continue

        methods = sorted(called)

        for info in kept:
            implementations = sorted(
                {
                    other.name
                    for other in classes.values()
                    if (info.module_id, info.name) in other.bases
                }
            )
            edges.append(
                {
                    "from": module_id,
                    "to": info.module_id,
                    "kind": "depends",
                    "line": parameter.lineno,
                    "names": methods,
                    "inferred": {
                        "parameter": parameter.arg,
                        "methods": methods,
                        "class": info.name,
                        "implementations": implementations,
                    },
                }
            )

    return edges
