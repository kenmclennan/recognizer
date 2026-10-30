import ast
import re

from recognizer_scan_python.analysis import declared_exports, is_abstraction, is_protocol

VALUE_LIMIT = 40
TAG_ORDER = ("property", "static", "classmethod", "abstract", "async")
CLASS_TAG_ORDER = ("dataclass", "frozen", "final", "runtime_checkable")

Function = ast.FunctionDef | ast.AsyncFunctionDef


def is_dunder(name: str) -> bool:
    return name.startswith("__") and name.endswith("__")


def is_private(name: str) -> bool:
    return name.startswith("_") and not is_dunder(name)


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def shorten(text: str) -> str:
    text = collapse(text)

    if len(text) <= VALUE_LIMIT:
        return text

    return text[: VALUE_LIMIT - 1] + "…"


def source_text(source: str, node: ast.expr) -> str:
    return ast.get_source_segment(source, node) or ast.unparse(node)


def decorator_name(decorator: ast.expr) -> str:
    if isinstance(decorator, ast.Call):
        decorator = decorator.func

    if isinstance(decorator, ast.Attribute):
        return decorator.attr

    if isinstance(decorator, ast.Name):
        return decorator.id

    return ""


def is_accessor_pair(function: Function) -> bool:
    return any(
        isinstance(d, ast.Attribute) and d.attr in ("setter", "deleter")
        for d in function.decorator_list
    )


def is_static(function: Function) -> bool:
    return any(decorator_name(d) == "staticmethod" for d in function.decorator_list)


def tags_of(function: Function, protocol: bool) -> list[str]:
    names = {decorator_name(d) for d in function.decorator_list}
    found = set()

    if "property" in names:
        found.add("property")

    if "staticmethod" in names:
        found.add("static")

    if "classmethod" in names:
        found.add("classmethod")

    if "abstractmethod" in names or protocol:
        found.add("abstract")

    if isinstance(function, ast.AsyncFunctionDef):
        found.add("async")

    return [tag for tag in TAG_ORDER if tag in found]


def is_frozen(decorator: ast.expr) -> bool:
    return isinstance(decorator, ast.Call) and any(
        keyword.arg == "frozen"
        and isinstance(keyword.value, ast.Constant)
        and keyword.value.value is True
        for keyword in decorator.keywords
    )


def class_tags_of(node: ast.ClassDef) -> list[str]:
    found = set()

    for decorator in node.decorator_list:
        name = decorator_name(decorator)

        if name == "dataclass":
            found.add("dataclass")

            if is_frozen(decorator):
                found.add("frozen")

        if name == "final":
            found.add("final")

        if name == "runtime_checkable":
            found.add("runtime_checkable")

    return [tag for tag in CLASS_TAG_ORDER if tag in found]


def parameter(argument: ast.arg) -> dict:
    found = {"name": argument.arg}

    if argument.annotation is not None:
        found["type"] = ast.unparse(argument.annotation)

    return found


def parameters(function: Function, drop_first: bool) -> list[dict]:
    arguments = function.args
    positional = [*arguments.posonlyargs, *arguments.args]

    if drop_first and positional:
        positional = positional[1:]

    found = list(positional)

    if arguments.vararg:
        found.append(arguments.vararg)

    found.extend(arguments.kwonlyargs)

    if arguments.kwarg:
        found.append(arguments.kwarg)

    return [parameter(argument) for argument in found]


def callable_outline(function: Function, drop_first: bool, protocol: bool) -> dict:
    outline = {"params": parameters(function, drop_first)}

    if function.returns is not None:
        outline["returns"] = ast.unparse(function.returns)

    tags = tags_of(function, protocol)

    if tags:
        outline["tags"] = tags

    return outline


def method_outline(function: Function, protocol: bool) -> dict:
    outline = callable_outline(function, not is_static(function), protocol)
    method = {
        "name": function.name,
        "line": function.lineno,
        "params": outline["params"],
        "private": is_private(function.name),
    }

    for key in ("returns", "tags"):
        if key in outline:
            method[key] = outline[key]

    return method


def plain_name_targets(node: ast.stmt) -> list[tuple[str, ast.expr | None]]:
    if isinstance(node, ast.Assign):
        return [(t.id, None) for t in node.targets if isinstance(t, ast.Name)]

    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return [(node.target.id, node.annotation)]

    return []


def self_attribute_targets(node: ast.AST) -> list[tuple[str, ast.expr | None]]:
    if isinstance(node, ast.Assign):
        pairs = [(t, None) for t in node.targets]
    elif isinstance(node, ast.AnnAssign):
        pairs = [(node.target, node.annotation)]
    else:
        return []

    return [
        (target.attr, annotation)
        for target, annotation in pairs
        if isinstance(target, ast.Attribute)
        and isinstance(target.value, ast.Name)
        and target.value.id == "self"
    ]


def class_fields(node: ast.ClassDef) -> list[dict]:
    found = []

    for statement in node.body:
        for name, annotation in plain_name_targets(statement):
            found.append((statement.lineno, statement.col_offset, name, annotation))

        if isinstance(statement, ast.FunctionDef) and statement.name == "__init__":
            for inner in ast.walk(statement):
                for name, annotation in self_attribute_targets(inner):
                    found.append((inner.lineno, inner.col_offset, name, annotation))

    fields = []
    seen = set()

    for line, _, name, annotation in sorted(found, key=lambda f: f[:2]):
        if name in seen:
            continue

        seen.add(name)
        field = {"name": name, "line": line, "private": is_private(name)}

        if annotation is not None:
            field["type"] = ast.unparse(annotation)

        fields.append(field)

    return fields


def class_member(node: ast.ClassDef, bindings: dict[str, str]) -> dict:
    protocol = is_protocol(node, bindings)
    methods = [
        method_outline(f, protocol)
        for f in node.body
        if isinstance(f, ast.FunctionDef | ast.AsyncFunctionDef) and not is_accessor_pair(f)
    ]

    member = {
        "kind": "interface" if is_abstraction(node, bindings) else "class",
        "bases": [ast.unparse(base) for base in node.bases],
        "fields": class_fields(node),
        "methods": methods,
    }
    tags = class_tags_of(node)

    if tags:
        member["tags"] = tags

    return member


def constant_names(statement: ast.stmt) -> list[str]:
    if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
        target = statement.targets[0]
    elif isinstance(statement, ast.AnnAssign) and statement.value is not None:
        target = statement.target
    else:
        return []

    if isinstance(target, ast.Name) and not is_dunder(target.id):
        return [target.id]

    return []


def read_members(tree: ast.Module, bindings: dict[str, str], source: str) -> list[dict]:
    exports = declared_exports(tree)
    members = []

    for statement in tree.body:
        if isinstance(statement, ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            name = statement.name
        else:
            names = constant_names(statement)
            name = names[0] if names else None

        if name is None or is_dunder(name):
            continue

        if isinstance(statement, ast.ClassDef):
            detail = class_member(statement, bindings)
        elif isinstance(statement, ast.FunctionDef | ast.AsyncFunctionDef):
            detail = {"kind": "function"} | callable_outline(statement, False, False)
        else:
            detail = {"kind": "constant", "value": shorten(source_text(source, statement.value))}

        exported = name in exports if exports is not None else not name.startswith("_")
        members.append(
            {
                "name": name,
                "kind": detail.pop("kind"),
                "line": statement.lineno,
                "exported": exported,
            }
            | detail
        )

    return members
