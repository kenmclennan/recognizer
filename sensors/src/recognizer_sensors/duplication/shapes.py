from tree_sitter import Node

from recognizer_sensors.duplication.normalise import is_comment, is_literal

BLOCK_TYPES = {"block", "statements"}
RETURN_TYPES = {"return_statement", "return_expression", "jump_expression"}
ASSIGNMENT_TYPES = {"assignment", "assignment_expression"}
MEMBER_TYPES = {
    "attribute",
    "member_expression",
    "field_expression",
    "navigation_expression",
    "member_access_expression",
}
SUBSCRIPT_TYPES = {
    "subscript",
    "subscript_expression",
    "index_expression",
    "indexing_expression",
    "element_access_expression",
}
CALL_TYPES = {"call", "call_expression", "invocation_expression"}
IDENTIFIER_LEAVES = {"identifier", "simple_identifier", "field_identifier", "property_identifier"}
SELF_TYPES = {"self", "this", "this_expression"}
INITIALISER_TYPES = {"shorthand_field_initializer", "field_initializer"}


def statements_of(function: Node) -> list[Node]:
    body = function.child_by_field_name("body")

    if body is None and function.type in {"property_declaration", "indexer_declaration"}:
        value = function.child_by_field_name("value")
        body = value if value is not None and value.type == "arrow_expression_clause" else None

    if body is None:
        body = next((c for c in function.children if c.type == "function_body"), None)

    if body is None:
        return []

    block = next((c for c in body.named_children if c.type in BLOCK_TYPES), None)

    if block is None and body.type in BLOCK_TYPES:
        block = body

    if block is None:
        return [c for c in body.named_children if not is_comment(c.type)]

    return [c for c in block.named_children if not is_comment(c.type) and not is_docstring(c)]


def is_docstring(node: Node) -> bool:
    return (
        node.type == "expression_statement"
        and node.named_child_count == 1
        and node.named_children[0].type == "string"
    )


def parameter_names(function: Node) -> set[str]:
    parameters = function.child_by_field_name("parameters")

    if parameters is None:
        parameters = next(
            (c for c in function.children if c.type == "function_value_parameters"), None
        )

    names: set[str] = set()

    for parameter in parameters.named_children if parameters else []:
        name = parameter.child_by_field_name("pattern") or parameter.child_by_field_name("name")

        if name is None and parameter.type in {"identifier", "simple_identifier"}:
            name = parameter

        if name is None:
            name = next(
                (
                    c
                    for c in parameter.named_children
                    if c.type in {"identifier", "simple_identifier"}
                ),
                None,
            )

        if name is not None and name.type in {"identifier", "simple_identifier"}:
            names.add(name.text.decode("utf-8", "replace"))

    return names


def is_self(node: Node) -> bool:
    return node.type in SELF_TYPES or node.text == b"self"


def is_atom(node: Node) -> bool:
    return is_literal(node.type) or is_self(node)


def unwrap_argument(node: Node) -> Node:
    if node.type in {"value_argument", "argument"} and node.named_children:
        return node.named_children[0]

    return node


def call_arguments(call: Node) -> list[Node]:
    arguments = call.child_by_field_name("arguments")

    if arguments is None:
        arguments = next((c for c in call.named_children if c.type == "value_arguments"), None)

    if arguments is None:
        suffix = next((c for c in call.named_children if c.type == "call_suffix"), None)
        arguments = (
            next((c for c in suffix.named_children if c.type == "value_arguments"), None)
            if suffix
            else None
        )

    if arguments is None:
        return []

    return [unwrap_argument(c) for c in arguments.named_children if not is_comment(c.type)]


def subscript_atoms(node: Node) -> list[Node]:
    if node.type in {"bracketed_argument_list", "indexing_suffix"}:
        return [unwrap_argument(c) for c in node.named_children if not is_comment(c.type)]

    return [node]


def lookup_chain(node: Node) -> bool:
    if node.child_count == 0:
        return node.type in IDENTIFIER_LEAVES or is_self(node)

    if node.type == "this_expression":
        return True

    if node.type in MEMBER_TYPES or node.type in SUBSCRIPT_TYPES:
        children = node.named_children

        if not children or not lookup_chain(children[0]):
            return False

        if node.type in SUBSCRIPT_TYPES:
            return all(is_atom(a) for c in children[1:] for a in subscript_atoms(c))

        return True

    if node.type in CALL_TYPES:
        callee = node.child_by_field_name("function") or (
            node.named_children[0] if node.named_children else None
        )

        return (
            callee is not None
            and callee.type in MEMBER_TYPES | SUBSCRIPT_TYPES | {"identifier", "simple_identifier"}
            and lookup_chain(callee)
            and all(is_atom(a) for a in call_arguments(node))
        )

    return False


def is_accessor_shape(function: Node) -> bool:
    statements = statements_of(function)

    if len(statements) != 1:
        return False

    statement = statements[0]

    if statement.type == "jump_expression" and not statement.text.startswith(b"return"):
        return False

    if statement.type in RETURN_TYPES:
        expression = statement.named_children[0] if statement.named_children else None
    else:
        expression = statement

    return (
        expression is not None
        and expression.type != "expression_statement"
        and lookup_chain(expression)
        and expression.type not in {"identifier"}
    )


def stores_a_parameter(node: Node, parameters: set[str]) -> bool:
    if node.type == "expression_statement" and node.named_child_count == 1:
        node = node.named_children[0]

    if node.type not in ASSIGNMENT_TYPES:
        return False

    operator = node.child_by_field_name("operator")

    if operator is not None and operator.text != b"=":
        return False

    right = node.child_by_field_name("right")

    if right is None and node.type == "assignment" and node.child_count >= 3:
        if node.children[1].text != b"=":
            return False

        right = node.children[-1]

    return right is not None and is_stored_value(right, parameters)


def is_stored_value(node: Node, parameters: set[str]) -> bool:
    if is_literal(node.type):
        return True

    return (
        node.type in {"identifier", "simple_identifier"}
        and node.text.decode("utf-8", "replace") in parameters
    )


def builds_from_parameters(node: Node, parameters: set[str]) -> bool:
    if node.type != "struct_expression":
        return False

    initialisers = node.child_by_field_name("body")

    if initialisers is None:
        return False

    fields = [c for c in initialisers.named_children if not is_comment(c.type)]

    if not fields or any(c.type not in INITIALISER_TYPES for c in fields):
        return False

    return all(
        c.type == "shorthand_field_initializer"
        and c.text.decode("utf-8", "replace") in parameters
        or (
            c.type == "field_initializer"
            and (value := c.child_by_field_name("value")) is not None
            and is_stored_value(value, parameters)
        )
        for c in fields
    )


def is_constructor_shape(function: Node) -> bool:
    statements = statements_of(function)

    if not statements:
        return False

    parameters = parameter_names(function)

    if len(statements) == 1 and builds_from_parameters(statements[0], parameters):
        return True

    return all(stores_a_parameter(s, parameters) for s in statements)


def is_trivial_shape(function: Node) -> bool:
    return is_constructor_shape(function) or is_accessor_shape(function)
