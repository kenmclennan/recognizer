import ast
import json
import sys


def docstring_nodes(tree):
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr):
                value = body[0].value
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    found.add(id(value))
    return found


def strings(source):
    tree = ast.parse(source)
    skip = docstring_nodes(tree)
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip:
            found.append((node.lineno, node.col_offset, node.value))
    found.sort()
    return [text for _, _, text in found]


def main(paths):
    result = {}
    if paths == ["--stdin"]:
        result["<stdin>"] = strings(sys.stdin.read())
        print(json.dumps(result))
        return
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            result[path] = strings(handle.read())
    print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv[1:])
