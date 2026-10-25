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
                hit = index.longest(parts)

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

        owner = index.longest(base) if base else None
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

            submodule = index.exact([*base, alias.name])

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


def declared_exports(tree: ast.Module) -> set[str] | None:
    assignments = []

    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            targets = statement.targets
        elif isinstance(statement, ast.AnnAssign) and statement.value is not None:
            targets = [statement.target]
        elif isinstance(statement, ast.AugAssign):
            targets = [statement.target]
        else:
            continue

        if any(isinstance(t, ast.Name) and t.id == "__all__" for t in targets):
            assignments.append(statement)

    if len(assignments) != 1 or isinstance(assignments[0], ast.AugAssign):
        return None

    value = assignments[0].value

    if not isinstance(value, ast.List | ast.Tuple):
        return None

    if not all(isinstance(e, ast.Constant) and isinstance(e.value, str) for e in value.elts):
        return None

    return {e.value for e in value.elts}


def module_level_classes(tree: ast.Module) -> list[ast.ClassDef]:
    return [s for s in tree.body if isinstance(s, ast.ClassDef)]


def module_kind(module_id: str, members: list[dict]) -> str:
    public = [member for member in members if not member["name"].startswith("_")]

    if public and all(member["kind"] == "interface" for member in public):
        return "interface"

    return "package" if module_id.rsplit("/", 1)[-1] == "__init__.py" else "module"
