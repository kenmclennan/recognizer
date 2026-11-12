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


def package_directory(module_id: str) -> str | None:
    head, _, name = module_id.rpartition("/")

    if name != "__init__.py" or not head:
        return None

    return head + "/"


def loaded_package_inits(
    module_ids: list[str],
    marked: set[str],
    pairs: list[tuple[str, str]],
) -> set[str]:
    loaded = set()

    for init in module_ids:
        directory = package_directory(init)

        if directory is None:
            continue

        inside = [m for m in module_ids if m.startswith(directory)]

        if any(m in marked for m in inside):
            loaded.add(init)

            continue

        inside_set = set(inside)

        if any(
            target in inside_set and not source.startswith(directory) for source, target in pairs
        ):
            loaded.add(init)

    return loaded
