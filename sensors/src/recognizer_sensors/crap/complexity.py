from tree_sitter import Node

NODE_TYPES = {
    "python": {
        "if_statement",
        "elif_clause",
        "for_statement",
        "while_statement",
        "except_clause",
        "conditional_expression",
        "for_in_clause",
        "if_clause",
        "case_clause",
    },
    "typescript": {
        "if_statement",
        "for_statement",
        "for_in_statement",
        "while_statement",
        "do_statement",
        "switch_case",
        "catch_clause",
        "ternary_expression",
        "optional_chain",
    },
    "kotlin": {
        "if_expression",
        "for_statement",
        "while_statement",
        "do_while_statement",
        "when_entry",
        "catch_block",
    },
    "rust": {"if_expression", "for_expression", "while_expression", "match_arm"},
    "csharp": {
        "if_statement",
        "for_statement",
        "foreach_statement",
        "while_statement",
        "do_statement",
        "switch_section",
        "switch_expression_arm",
        "catch_clause",
        "conditional_expression",
        "conditional_access_expression",
    },
}

NODE_TYPES["tsx"] = NODE_TYPES["typescript"]

OPERATOR_NODES = {"binary_expression", "boolean_operator"}

OPERATORS = {
    "python": {"and", "or"},
    "typescript": {"&&", "||", "??"},
    "kotlin": {"&&", "||"},
    "rust": {"&&", "||"},
    "csharp": {"&&", "||", "??"},
}

OPERATORS["tsx"] = OPERATORS["typescript"]


def adds_one(node: Node, grammar: str) -> bool:
    if node.type in NODE_TYPES[grammar]:
        return True

    if node.type not in OPERATOR_NODES:
        return False

    operator = node.child_by_field_name("operator")

    return operator is not None and operator.type in OPERATORS[grammar]


def cyclomatic_complexity(node: Node, grammar: str, excluded: set[int]) -> int:
    total = 1
    stack = list(node.children)

    while stack:
        current = stack.pop()

        if current.id in excluded:
            continue

        if adds_one(current, grammar):
            total += 1

        stack.extend(current.children)

    return total
