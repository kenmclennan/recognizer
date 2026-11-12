import ast
from dataclasses import dataclass, field

from recognizer_scan_python.index import ModuleIndex

PROTOCOL_BASES = {"typing.Protocol", "typing_extensions.Protocol"}
ABSTRACT_BASES = {*PROTOCOL_BASES, "abc.ABC"}
ABSTRACT_METACLASS = "abc.ABCMeta"


@dataclass
class NamedImport:
    line: int
    owner: str
    exact: bool
    names: list[str]


@dataclass
class Imports:
    whole: set[tuple[str, int]] = field(default_factory=set)
    named: list[NamedImport] = field(default_factory=list)
    foreign: set[tuple[str, int]] = field(default_factory=set)
    bindings: dict[str, str] = field(default_factory=dict)
    reexports: dict[str, tuple[str, str]] = field(default_factory=dict)
    stars: list[str] = field(default_factory=list)


def import_statements(tree: ast.Module) -> list[ast.Import | ast.ImportFrom]:
    statements = [n for n in ast.walk(tree) if isinstance(n, ast.Import | ast.ImportFrom)]

    return sorted(statements, key=lambda n: (n.lineno, n.col_offset))


def module_level_statements(body: list[ast.stmt]):
    for statement in body:
        yield statement

        if isinstance(statement, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            continue

        for attribute in ("body", "orelse", "finalbody"):
            yield from module_level_statements(getattr(statement, attribute, []))

        for handler in getattr(statement, "handlers", []):
            yield from module_level_statements(handler.body)

        for case in getattr(statement, "cases", []):
            yield from module_level_statements(case.body)


def target_names(target: ast.expr) -> list[str]:
    if isinstance(target, ast.Name):
        return [target.id]

    if isinstance(target, ast.Tuple | ast.List):
        return [name for element in target.elts for name in target_names(element)]

    if isinstance(target, ast.Starred):
        return target_names(target.value)

    return []


def defined_names(tree: ast.Module) -> set[str]:
    names = set()

    for statement in module_level_statements(tree.body):
        if isinstance(statement, ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            names.add(statement.name)
        elif isinstance(statement, ast.Assign):
            for target in statement.targets:
                names.update(target_names(target))
        elif isinstance(statement, ast.AnnAssign):
            names.update(target_names(statement.target))

    return names


def relative_base(node: ast.ImportFrom, package: tuple[str, ...] | None) -> list[str] | None:
    if package is None or node.level - 1 > len(package):
        return None

    kept = list(package[: len(package) - (node.level - 1)])

    return kept + (node.module.split(".") if node.module else [])


def read_imports(module_id: str, tree: ast.Module, index: ModuleIndex) -> Imports:
    imports = Imports()
    package = index.package_parts(module_id)
    top_level = {id(n) for n in module_level_statements(tree.body)}

    def add_edge(target: str | None, line: int) -> None:
        if target is not None and target != module_id:
            imports.whole.add((target, line))

    for node in import_statements(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                parts = alias.name.split(".")
                hit = index.longest(parts, importer=module_id)

                if hit:
                    add_edge(hit.module_id, node.lineno)
                else:
                    imports.foreign.add((parts[0], node.lineno))

                if alias.asname:
                    imports.bindings[alias.asname] = alias.name
                else:
                    imports.bindings[parts[0]] = parts[0]

            continue

        if node.level == 0 and node.module == "__future__":
            continue

        relative = node.level > 0
        base = relative_base(node, package) if relative else node.module.split(".")

        if base is None:
            continue

        owner = index.longest(base, importer=module_id) if base else None
        exact = owner is not None and owner.length == len(base)
        named = NamedImport(node.lineno, owner.module_id, exact, []) if owner else None

        for alias in node.names:
            if alias.name == "*":
                if owner:
                    add_edge(owner.module_id, node.lineno)

                    if exact and id(node) in top_level:
                        imports.stars.append(owner.module_id)
                elif not relative:
                    imports.foreign.add((base[0], node.lineno))

                continue

            submodule = index.exact([*base, alias.name], importer=module_id)

            if submodule:
                add_edge(submodule, node.lineno)
            elif named:
                named.names.append(alias.name)

                if exact and id(node) in top_level:
                    imports.reexports[alias.asname or alias.name] = (owner.module_id, alias.name)
            elif not relative:
                imports.foreign.add((base[0], node.lineno))

            imports.bindings[alias.asname or alias.name] = ".".join([*base, alias.name])

        if named and named.names:
            imports.named.append(named)

    return imports


def expand(expression: ast.expr, bindings: dict[str, str]) -> list[str] | None:
    if isinstance(expression, ast.Subscript):
        expression = expression.value

    chain = []

    while isinstance(expression, ast.Attribute):
        chain.append(expression.attr)
        expression = expression.value

    if not isinstance(expression, ast.Name) or expression.id not in bindings:
        return None

    return [*bindings[expression.id].split("."), *reversed(chain)]


def is_protocol(node: ast.ClassDef, bindings: dict[str, str]) -> bool:
    for base in node.bases:
        path = expand(base, bindings)

        if path and ".".join(path) in PROTOCOL_BASES:
            return True

    return False


def is_abstraction(node: ast.ClassDef, bindings: dict[str, str]) -> bool:
    for base in node.bases:
        path = expand(base, bindings)

        if path and ".".join(path) in ABSTRACT_BASES:
            return True

    for keyword in node.keywords:
        path = expand(keyword.value, bindings) if keyword.arg == "metaclass" else None

        if path and ".".join(path) == ABSTRACT_METACLASS:
            return True

    return False


def string_literals(value: ast.expr, allow_concatenation: bool) -> list[str] | None:
    if isinstance(value, ast.List | ast.Tuple):
        if all(isinstance(e, ast.Constant) and isinstance(e.value, str) for e in value.elts):
            return [e.value for e in value.elts]

        return None

    if allow_concatenation and isinstance(value, ast.BinOp) and isinstance(value.op, ast.Add):
        left = string_literals(value.left, True)
        right = string_literals(value.right, True)

        if left is None or right is None:
            return None

        return left + right

    return None


def is_all_name(node: ast.expr) -> bool:
    return isinstance(node, ast.Name) and node.id == "__all__"


def touches_all(node: ast.expr) -> bool:
    return is_all_name(node) or (isinstance(node, ast.Subscript) and is_all_name(node.value))


def mutates_all(statement: ast.stmt) -> bool:
    if isinstance(statement, ast.Assign):
        return any(touches_all(t) for t in statement.targets)

    if isinstance(statement, ast.AnnAssign):
        return statement.value is not None and touches_all(statement.target)

    if isinstance(statement, ast.AugAssign):
        return touches_all(statement.target)

    if isinstance(statement, ast.Delete):
        return any(touches_all(t) for t in statement.targets)

    if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call):
        function = statement.value.func

        return isinstance(function, ast.Attribute) and is_all_name(function.value)

    return False


def apply_to_all(statement: ast.stmt, names: list[str] | None) -> list[str] | None:
    if isinstance(statement, ast.Assign):
        if not any(is_all_name(t) for t in statement.targets):
            return None

        return string_literals(statement.value, True)

    if isinstance(statement, ast.AnnAssign):
        if not is_all_name(statement.target):
            return None

        return string_literals(statement.value, True)

    if names is None:
        return None

    if isinstance(statement, ast.AugAssign):
        if not is_all_name(statement.target) or not isinstance(statement.op, ast.Add):
            return None

        added = string_literals(statement.value, True)

        return None if added is None else names + added

    if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call):
        call = statement.value

        if call.keywords or len(call.args) != 1 or not isinstance(call.func, ast.Attribute):
            return None

        argument = call.args[0]

        if call.func.attr == "extend":
            added = string_literals(argument, False)

            return None if added is None else names + added

        if (
            call.func.attr == "append"
            and isinstance(argument, ast.Constant)
            and isinstance(argument.value, str)
        ):
            return [*names, argument.value]

    return None


def declared_exports(tree: ast.Module) -> set[str] | None:
    top_level = {id(statement) for statement in tree.body}
    names: list[str] | None = None

    for statement in module_level_statements(tree.body):
        if not mutates_all(statement):
            continue

        if id(statement) not in top_level:
            return None

        names = apply_to_all(statement, names)

        if names is None:
            return None

    return None if names is None else set(names)


def module_level_classes(tree: ast.Module) -> list[ast.ClassDef]:
    return [s for s in tree.body if isinstance(s, ast.ClassDef)]


def module_kind(module_id: str, members: list[dict]) -> str:
    public = [member for member in members if not member["name"].startswith("_")]

    if public and all(member["kind"] == "interface" for member in public):
        return "interface"

    return "package" if module_id.rsplit("/", 1)[-1] == "__init__.py" else "module"
