import ast
from dataclasses import dataclass, field

from recognizer_scan_python.analysis import defined_names
from recognizer_scan_python.index import ModuleIndex
from recognizer_scan_python.infer import (
    ClassInfo,
    ClassKey,
    called_on,
    function_nodes,
    gated_matches,
    is_name,
    is_self_attribute,
    stored_attributes,
    untyped_parameters,
)
from recognizer_scan_python.outline import is_accessor_pair, is_static
from recognizer_scan_python.routes import Router

Function = ast.FunctionDef | ast.AsyncFunctionDef


@dataclass
class Located:
    module: str
    name: str | None
    rest: list[str]


@dataclass
class Context:
    module_id: str
    locals: set[str]
    env: dict[str, ClassKey]
    owner: ClassKey | None
    self_name: str | None
    untyped: dict[str, list[ClassInfo]]


@dataclass
class Holders:
    types: dict[str, ClassKey] = field(default_factory=dict)
    matches: dict[str, list[ClassInfo]] = field(default_factory=dict)


def attribute_chain(expression: ast.expr) -> tuple[str, list[str]] | None:
    attributes = []

    while isinstance(expression, ast.Attribute):
        attributes.append(expression.attr)
        expression = expression.value

    if not isinstance(expression, ast.Name):
        return None

    return expression.id, list(reversed(attributes))


def walk_body(body: list[ast.stmt]):
    stack = list(body)

    while stack:
        node = stack.pop()

        if isinstance(node, ast.ClassDef):
            continue

        yield node

        stack.extend(ast.iter_child_nodes(node))


def local_names(function: Function) -> set[str]:
    names = {a.arg for a in ast.walk(function.args) if isinstance(a, ast.arg)}

    for node in walk_body(function.body):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            names.add(node.id)
        elif isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            names.add(node.name)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)

    return names


class CallResolver:
    def __init__(
        self,
        parsed: dict,
        classes: dict[ClassKey, ClassInfo],
        members: dict[str, list[dict]],
        index: ModuleIndex,
        router: Router,
    ):
        self.parsed = parsed
        self.classes = classes
        self.index = index
        self.router = router
        self.defined = {m: defined_names(p.tree) for m, p in parsed.items()}
        self.usable = {m for m in parsed if "::" not in m}
        self.endpoints: set[str] = set()
        self.own_methods: dict[ClassKey, set[str]] = {}
        self.abstract_methods: dict[ClassKey, list[dict]] = {}

        for module_id in self.usable:
            for member in members[module_id]:
                if member["kind"] == "constant" or member["kind"] == "type":
                    continue

                self.endpoints.add(f"{module_id}::{member['name']}")

                for method in member.get("methods", []):
                    self.endpoints.add(f"{module_id}::{member['name']}.{method['name']}")
                    self.own_methods.setdefault((module_id, member["name"]), set()).add(
                        method["name"]
                    )

                    if "abstract" in method.get("tags", []):
                        self.abstract_methods.setdefault((module_id, member["name"]), []).append(
                            method
                        )

        self.class_nodes = {
            (m, n.name): n
            for m, p in parsed.items()
            for n in p.tree.body
            if isinstance(n, ast.ClassDef)
        }
        self.holders = {key: Holders() for key in self.classes}
        self.setup_holders()

    def locate(self, path: list[str]) -> Located | None:
        hit = self.index.longest(path)

        if hit is None:
            return None

        rest = path[hit.length :]

        if not rest:
            return Located(hit.module_id, None, [])

        module, _ = self.router.follow(hit.module_id, rest[0])[0]

        return Located(module, rest[0], rest[1:])

    def symbol(self, module_id: str, expression: ast.expr, shadowed: set[str]) -> Located | None:
        chain = attribute_chain(expression)

        if chain is None:
            return None

        root, attributes = chain

        if root in shadowed:
            return None

        if root in self.defined[module_id]:
            return Located(module_id, root, attributes)

        bindings = self.parsed[module_id].imports.bindings

        if root in bindings:
            return self.locate([*bindings[root].split("."), *attributes])

        return None

    def class_key(self, located: Located | None) -> ClassKey | None:
        if located is None or located.name is None or located.rest:
            return None

        key = (located.module, located.name)

        return key if key in self.classes else None

    def annotated_class(self, annotation: ast.expr, module_id: str) -> ClassKey | None:
        if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
            try:
                parsed = ast.parse(annotation.value, mode="eval").body
            except SyntaxError:
                return None

            return self.annotated_class(parsed, module_id)

        if isinstance(annotation, ast.Subscript):
            outer = annotation.value
            name = outer.attr if isinstance(outer, ast.Attribute) else getattr(outer, "id", "")

            return self.annotated_class(annotation.slice, module_id) if name == "Optional" else None

        if isinstance(annotation, ast.BinOp) and isinstance(annotation.op, ast.BitOr):
            for kept, other in (
                (annotation.left, annotation.right),
                (annotation.right, annotation.left),
            ):
                if isinstance(other, ast.Constant) and other.value is None:
                    return self.annotated_class(kept, module_id)

            return None

        return self.class_key(self.symbol(module_id, annotation, set()))

    def lookup_method(self, key: ClassKey, method: str, seen: set | None = None) -> ClassKey | None:
        seen = seen if seen is not None else set()

        if key in seen:
            return None

        seen.add(key)

        if method in self.own_methods.get(key, ()):
            return key

        for base in self.classes[key].bases:
            found = self.lookup_method(base, method, seen)

            if found:
                return found

        return None

    def lookup_holder(self, key: ClassKey, attribute: str, seen: set | None = None):
        seen = seen if seen is not None else set()

        if key in seen:
            return None, []

        seen.add(key)
        holders = self.holders[key]

        if attribute in holders.types or attribute in holders.matches:
            return holders.types.get(attribute), holders.matches.get(attribute, [])

        for base in self.classes[key].bases:
            found = self.lookup_holder(base, attribute, seen)

            if found[0] or found[1]:
                return found

        return None, []

    def environment(self, function: Function, module_id: str, locals_: set[str]) -> dict:
        env = {}

        for argument in ast.walk(function.args):
            if isinstance(argument, ast.arg) and argument.annotation is not None:
                key = self.annotated_class(argument.annotation, module_id)

                if key:
                    env[argument.arg] = key

        assignments = [
            n for n in walk_body(function.body) if isinstance(n, ast.Assign | ast.AnnAssign)
        ]

        for node in sorted(assignments, key=lambda n: (n.lineno, n.col_offset)):
            if isinstance(node, ast.Assign):
                if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
                    continue

                target, annotation = node.targets[0].id, None
            else:
                if not isinstance(node.target, ast.Name):
                    continue

                target, annotation = node.target.id, node.annotation

            key = None

            if annotation is not None:
                key = self.annotated_class(annotation, module_id)

            if key is None and isinstance(node.value, ast.Call):
                key = self.class_key(self.symbol(module_id, node.value.func, locals_ - {target}))

            if key and target not in env:
                env[target] = key

        return env

    def setup_holders(self) -> None:
        for key, node in self.class_nodes.items():
            if key not in self.classes:
                continue

            module_id = key[0]
            holders = self.holders[key]
            methods = function_nodes(node.body)

            for function in methods:
                locals_ = local_names(function)
                env = self.environment(function, module_id, locals_)

                if function.name == "__init__":
                    self.record_attribute_types(function, module_id, env, locals_, holders)

                for parameter in untyped_parameters(function, True):
                    attributes = stored_attributes(function, parameter.arg)
                    called = called_on(function.body, is_name(parameter.arg))

                    for attribute in attributes:
                        for method in methods:
                            called |= called_on(method.body, is_self_attribute(attribute))

                    matches = gated_matches(called, self.classes)

                    for attribute in attributes:
                        if matches and attribute not in holders.types:
                            holders.matches.setdefault(attribute, []).extend(
                                m for m in matches if m not in holders.matches.get(attribute, [])
                            )

    def record_attribute_types(self, function, module_id, env, locals_, holders) -> None:
        for node in ast.walk(function):
            if isinstance(node, ast.Assign):
                pairs = [(t, None) for t in node.targets]
            elif isinstance(node, ast.AnnAssign):
                pairs = [(node.target, node.annotation)]
            else:
                continue

            for target, annotation in pairs:
                if not (
                    isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name)
                    and target.value.id == "self"
                ):
                    continue

                found = None

                if annotation is not None:
                    found = self.annotated_class(annotation, module_id)

                value = getattr(node, "value", None)

                if found is None and isinstance(value, ast.Call):
                    found = self.class_key(self.symbol(module_id, value.func, locals_))

                if found is None and isinstance(value, ast.Name):
                    found = env.get(value.id)

                if found and target.attr not in holders.types:
                    holders.types[target.attr] = found

    def type_of(self, expression: ast.expr, context: Context) -> ClassKey | None:
        if isinstance(expression, ast.Name):
            if expression.id == context.self_name:
                return context.owner

            return context.env.get(expression.id)

        if isinstance(expression, ast.Attribute):
            if (
                isinstance(expression.value, ast.Name)
                and expression.value.id == context.self_name
                and context.owner
            ):
                return self.lookup_holder(context.owner, expression.attr)[0]

            return None

        if isinstance(expression, ast.Call):
            return self.class_key(self.symbol(context.module_id, expression.func, context.locals))

        return None

    def inferred_matches(self, expression: ast.expr, context: Context) -> list[ClassInfo]:
        if isinstance(expression, ast.Name):
            if expression.id in context.env:
                return []

            return context.untyped.get(expression.id, [])

        if (
            isinstance(expression, ast.Attribute)
            and isinstance(expression.value, ast.Name)
            and expression.value.id == context.self_name
            and context.owner
        ):
            types, matches = self.lookup_holder(context.owner, expression.attr)

            return [] if types else matches

        return []

    def method_ref(self, key: ClassKey, method: str) -> str | None:
        defining = self.lookup_method(key, method)

        return f"{defining[0]}::{defining[1]}.{method}" if defining else None

    def resolve(self, call: ast.Call, context: Context) -> list[tuple[str, str]]:
        func = call.func

        if isinstance(func, ast.Attribute):
            key = self.type_of(func.value, context)

            if key:
                ref = self.method_ref(key, func.attr)

                return [(ref, "call")] if ref else []

            matches = self.inferred_matches(func.value, context)

            if matches:
                refs = [self.method_ref((info.module_id, info.name), func.attr) for info in matches]

                return [(ref, "inferred") for ref in refs if ref]

        located = self.symbol(context.module_id, func, context.locals)

        if located is None or located.name is None:
            return []

        key = (located.module, located.name)

        if key in self.classes:
            if not located.rest:
                return [(f"{key[0]}::{key[1]}", "construct")]

            if len(located.rest) == 1:
                ref = self.method_ref(key, located.rest[0])

                return [(ref, "call")] if ref else []

            return []

        if located.rest:
            return []

        return [(f"{located.module}::{located.name}", "call")]

    def context_for(self, function: Function, module_id: str, owner: ClassKey | None) -> Context:
        locals_ = local_names(function)
        env = self.environment(function, module_id, locals_)
        positional = [*function.args.posonlyargs, *function.args.args]
        self_name = positional[0].arg if owner and positional and not is_static(function) else None
        untyped = {}

        for parameter in untyped_parameters(function, owner is not None):
            called = called_on(function.body, is_name(parameter.arg))

            if owner:
                for attribute in stored_attributes(function, parameter.arg):
                    for method in function_nodes(self.class_nodes[owner].body):
                        called |= called_on(method.body, is_self_attribute(attribute))

            untyped[parameter.arg] = gated_matches(called, self.classes)

        return Context(module_id, locals_, env, owner, self_name, untyped)

    def calls_in(self, function: Function, caller: str, context: Context, found: set) -> None:
        for node in walk_body(function.body):
            if not isinstance(node, ast.Call):
                continue

            for ref, how in self.resolve(node, context):
                found.add((caller, node.lineno, ref, how))

    def scan_calls(self) -> list[dict]:
        found = set()

        for module_id in sorted(self.usable):
            tree = self.parsed[module_id].tree

            for node in tree.body:
                if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                    context = self.context_for(node, module_id, None)
                    self.calls_in(node, f"{module_id}::{node.name}", context, found)

                if isinstance(node, ast.ClassDef) and (module_id, node.name) in self.classes:
                    owner = (module_id, node.name)

                    for function in function_nodes(node.body):
                        if is_accessor_pair(function):
                            continue

                        context = self.context_for(function, module_id, owner)
                        caller = f"{module_id}::{node.name}.{function.name}"
                        self.calls_in(function, caller, context, found)

        self.add_dispatch(found)

        calls = [
            {"from": source, "to": target, "line": line, "how": how}
            for source, line, target, how in found
            if source in self.endpoints and target in self.endpoints and source != target
        ]

        return sorted(calls, key=lambda c: (c["from"], c["line"], c["to"], c["how"]))

    def subclasses(self, key: ClassKey) -> list[ClassKey]:
        found = []
        pending = [key]
        seen = {key}

        while pending:
            current = pending.pop()

            for other, info in self.classes.items():
                if current in info.bases and other not in seen:
                    seen.add(other)
                    found.append(other)
                    pending.append(other)

        return found

    def add_dispatch(self, found: set) -> None:
        for key, methods in self.abstract_methods.items():
            for method in methods:
                for subclass in self.subclasses(key):
                    if method["name"] in self.own_methods.get(subclass, ()):
                        found.add(
                            (
                                f"{key[0]}::{key[1]}.{method['name']}",
                                method["line"],
                                f"{subclass[0]}::{subclass[1]}.{method['name']}",
                                "dispatch",
                            )
                        )
