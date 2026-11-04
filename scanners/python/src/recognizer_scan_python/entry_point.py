import ast


def is_entry_point(module_id: str, tree: ast.Module) -> bool:
    if module_id.rsplit("/", 1)[-1] == "__main__.py":
        return True

    return any(is_main_guard(node) for node in tree.body)


def is_main_guard(node: ast.stmt) -> bool:
    if not isinstance(node, ast.If) or not isinstance(node.test, ast.Compare):
        return False

    test = node.test

    if len(test.ops) != 1 or not isinstance(test.ops[0], ast.Eq):
        return False

    operands = [test.left, *test.comparators]
    names = [o.id for o in operands if isinstance(o, ast.Name)]
    values = [o.value for o in operands if isinstance(o, ast.Constant)]

    return names == ["__name__"] and values == ["__main__"]
