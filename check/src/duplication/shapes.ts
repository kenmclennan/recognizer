import { isComment, isLiteral } from "./normalise.js";
import { childrenOf, namedChildrenOf, type SyntaxNode } from "./syntax.js";

const BLOCK_TYPES = new Set(["block", "statements"]);
const RETURN_TYPES = new Set([
  "return_statement",
  "return_expression",
  "jump_expression",
]);
const ASSIGNMENT_TYPES = new Set(["assignment", "assignment_expression"]);
const MEMBER_TYPES = new Set([
  "attribute",
  "member_expression",
  "field_expression",
  "navigation_expression",
  "member_access_expression",
]);
const SUBSCRIPT_TYPES = new Set([
  "subscript",
  "subscript_expression",
  "index_expression",
  "indexing_expression",
  "element_access_expression",
]);
const CALL_TYPES = new Set([
  "call",
  "call_expression",
  "invocation_expression",
]);
const IDENTIFIER_LEAVES = new Set([
  "identifier",
  "simple_identifier",
  "field_identifier",
  "property_identifier",
]);
const SELF_TYPES = new Set(["self", "this", "this_expression"]);
const INITIALISER_TYPES = new Set([
  "shorthand_field_initializer",
  "field_initializer",
]);
const PLAIN_NAMES = new Set(["identifier", "simple_identifier"]);
const CALLEE_TYPES = new Set([
  ...MEMBER_TYPES,
  ...SUBSCRIPT_TYPES,
  "identifier",
  "simple_identifier",
]);

function isDocstring(node: SyntaxNode): boolean {
  return (
    node.type === "expression_statement" &&
    node.namedChildCount === 1 &&
    namedChildrenOf(node)[0]?.type === "string"
  );
}

function statementsOf(fn: SyntaxNode): SyntaxNode[] {
  let body = fn.childForFieldName("body");

  if (
    body === null &&
    (fn.type === "property_declaration" || fn.type === "indexer_declaration")
  ) {
    const value = fn.childForFieldName("value");

    body =
      value !== null && value.type === "arrow_expression_clause" ? value : null;
  }

  body ??= childrenOf(fn).find((c) => c.type === "function_body") ?? null;

  if (body === null) {
    return [];
  }

  const named = namedChildrenOf(body);
  let block = named.find((c) => BLOCK_TYPES.has(c.type)) ?? null;

  if (block === null && BLOCK_TYPES.has(body.type)) {
    block = body;
  }

  if (block === null) {
    return named.filter((c) => !isComment(c.type));
  }

  return namedChildrenOf(block).filter(
    (c) => !isComment(c.type) && !isDocstring(c),
  );
}

function parameterNames(fn: SyntaxNode): Set<string> {
  const parameters =
    fn.childForFieldName("parameters") ??
    childrenOf(fn).find((c) => c.type === "function_value_parameters") ??
    null;
  const names = new Set<string>();

  for (const parameter of parameters === null
    ? []
    : namedChildrenOf(parameters)) {
    let name =
      parameter.childForFieldName("pattern") ??
      parameter.childForFieldName("name");

    if (name === null && PLAIN_NAMES.has(parameter.type)) {
      name = parameter;
    }

    name ??=
      namedChildrenOf(parameter).find((c) => PLAIN_NAMES.has(c.type)) ?? null;

    if (name !== null && PLAIN_NAMES.has(name.type)) {
      names.add(name.text);
    }
  }

  return names;
}

function isSelf(node: SyntaxNode): boolean {
  return SELF_TYPES.has(node.type) || node.text === "self";
}

function isAtom(node: SyntaxNode): boolean {
  return isLiteral(node.type) || isSelf(node);
}

function unwrapArgument(node: SyntaxNode): SyntaxNode {
  const first = namedChildrenOf(node)[0];

  if ((node.type === "value_argument" || node.type === "argument") && first) {
    return first;
  }

  return node;
}

function callArguments(call: SyntaxNode): SyntaxNode[] {
  let args = call.childForFieldName("arguments");

  args ??=
    namedChildrenOf(call).find((c) => c.type === "value_arguments") ?? null;

  if (args === null) {
    const suffix = namedChildrenOf(call).find((c) => c.type === "call_suffix");

    args =
      suffix === undefined
        ? null
        : (namedChildrenOf(suffix).find((c) => c.type === "value_arguments") ??
          null);
  }

  if (args === null) {
    return [];
  }

  return namedChildrenOf(args)
    .filter((c) => !isComment(c.type))
    .map(unwrapArgument);
}

function subscriptAtoms(node: SyntaxNode): SyntaxNode[] {
  if (
    node.type === "bracketed_argument_list" ||
    node.type === "indexing_suffix"
  ) {
    return namedChildrenOf(node)
      .filter((c) => !isComment(c.type))
      .map(unwrapArgument);
  }

  return [node];
}

function lookupChain(start: SyntaxNode): boolean {
  let node = start;

  for (;;) {
    if (node.childCount === 0) {
      return IDENTIFIER_LEAVES.has(node.type) || isSelf(node);
    }

    if (node.type === "this_expression") {
      return true;
    }

    if (MEMBER_TYPES.has(node.type) || SUBSCRIPT_TYPES.has(node.type)) {
      const children = namedChildrenOf(node);
      const [head, ...rest] = children;

      if (head === undefined) {
        return false;
      }

      if (
        SUBSCRIPT_TYPES.has(node.type) &&
        !rest.every((c) => subscriptAtoms(c).every(isAtom))
      ) {
        return false;
      }

      node = head;

      continue;
    }

    if (CALL_TYPES.has(node.type)) {
      const callee =
        node.childForFieldName("function") ?? namedChildrenOf(node)[0] ?? null;

      if (
        callee === null ||
        !CALLEE_TYPES.has(callee.type) ||
        !callArguments(node).every(isAtom)
      ) {
        return false;
      }

      node = callee;

      continue;
    }

    return false;
  }
}

function isAccessorShape(fn: SyntaxNode): boolean {
  const statements = statementsOf(fn);

  if (statements.length !== 1) {
    return false;
  }

  const statement = statements[0] as SyntaxNode;

  if (
    statement.type === "jump_expression" &&
    !statement.text.startsWith("return")
  ) {
    return false;
  }

  const expression = RETURN_TYPES.has(statement.type)
    ? (namedChildrenOf(statement)[0] ?? null)
    : statement;

  return (
    expression !== null &&
    expression.type !== "expression_statement" &&
    lookupChain(expression) &&
    expression.type !== "identifier"
  );
}

function isStoredValue(node: SyntaxNode, parameters: Set<string>): boolean {
  if (isLiteral(node.type)) {
    return true;
  }

  return PLAIN_NAMES.has(node.type) && parameters.has(node.text);
}

function storesAParameter(start: SyntaxNode, parameters: Set<string>): boolean {
  let node = start;

  if (node.type === "expression_statement" && node.namedChildCount === 1) {
    node = namedChildrenOf(node)[0] as SyntaxNode;
  }

  if (!ASSIGNMENT_TYPES.has(node.type)) {
    return false;
  }

  const operator = node.childForFieldName("operator");

  if (operator !== null && operator.text !== "=") {
    return false;
  }

  let right = node.childForFieldName("right");

  if (right === null && node.type === "assignment" && node.childCount >= 3) {
    const children = childrenOf(node);

    if ((children[1] as SyntaxNode).text !== "=") {
      return false;
    }

    right = children.at(-1) as SyntaxNode;
  }

  return right !== null && isStoredValue(right, parameters);
}

function buildsFromParameters(
  node: SyntaxNode,
  parameters: Set<string>,
): boolean {
  if (node.type !== "struct_expression") {
    return false;
  }

  const initialisers = node.childForFieldName("body");

  if (initialisers === null) {
    return false;
  }

  const fields = namedChildrenOf(initialisers).filter(
    (c) => !isComment(c.type),
  );

  if (
    fields.length === 0 ||
    fields.some((c) => !INITIALISER_TYPES.has(c.type))
  ) {
    return false;
  }

  return fields.every((c) => {
    if (c.type === "shorthand_field_initializer" && parameters.has(c.text)) {
      return true;
    }

    const value = c.childForFieldName("value");

    return (
      c.type === "field_initializer" &&
      value !== null &&
      isStoredValue(value, parameters)
    );
  });
}

function isConstructorShape(fn: SyntaxNode): boolean {
  const statements = statementsOf(fn);

  if (statements.length === 0) {
    return false;
  }

  const parameters = parameterNames(fn);

  if (
    statements.length === 1 &&
    buildsFromParameters(statements[0] as SyntaxNode, parameters)
  ) {
    return true;
  }

  return statements.every((s) => storesAParameter(s, parameters));
}

export function isTrivialShape(fn: SyntaxNode): boolean {
  return isConstructorShape(fn) || isAccessorShape(fn);
}
