import { isComment, isLiteral } from "./normalise.js";
import {
  childrenOf,
  fieldChild,
  namedChildrenOf,
  type SyntaxNode,
} from "./syntax.js";
import type { Vocabulary } from "./vocabulary.js";

function isDocstring(node: SyntaxNode, vocabulary: Vocabulary): boolean {
  return (
    vocabulary.expressionStatementTypes.has(node.type) &&
    node.namedChildCount === 1 &&
    vocabulary.docstringStringTypes.has(
      namedChildrenOf(node)[0]?.type as string,
    )
  );
}

export function bodyOf(
  fn: SyntaxNode,
  vocabulary: Vocabulary,
): SyntaxNode | null {
  let body = fieldChild(fn, vocabulary.fields.body);

  if (body === null && vocabulary.expressionBodiedTypes.has(fn.type)) {
    const value = fieldChild(fn, vocabulary.fields.expression_body);

    body =
      value !== null && vocabulary.expressionBodyTypes.has(value.type)
        ? value
        : null;
  }

  return (
    body ??
    childrenOf(fn).find((c) => vocabulary.functionBodyTypes.has(c.type)) ??
    null
  );
}

function statementsOf(fn: SyntaxNode, vocabulary: Vocabulary): SyntaxNode[] {
  const body = bodyOf(fn, vocabulary);

  if (body === null) {
    return [];
  }

  const named = namedChildrenOf(body);
  let block = named.find((c) => vocabulary.blockTypes.has(c.type)) ?? null;

  if (block === null && vocabulary.blockTypes.has(body.type)) {
    block = body;
  }

  if (block === null) {
    return named.filter((c) => !isComment(c.type, vocabulary));
  }

  return namedChildrenOf(block).filter(
    (c) => !isComment(c.type, vocabulary) && !isDocstring(c, vocabulary),
  );
}

function parameterNames(fn: SyntaxNode, vocabulary: Vocabulary): Set<string> {
  const parameters =
    fieldChild(fn, vocabulary.fields.parameters) ??
    childrenOf(fn).find((c) => vocabulary.parameterListTypes.has(c.type)) ??
    null;
  const names = new Set<string>();

  for (const parameter of parameters === null
    ? []
    : namedChildrenOf(parameters)) {
    let name =
      fieldChild(parameter, vocabulary.fields.parameter_pattern) ??
      fieldChild(parameter, vocabulary.fields.name);

    if (name === null && vocabulary.plainNameTypes.has(parameter.type)) {
      name = parameter;
    }

    name ??=
      namedChildrenOf(parameter).find((c) =>
        vocabulary.plainNameTypes.has(c.type),
      ) ?? null;

    if (name !== null && vocabulary.plainNameTypes.has(name.type)) {
      names.add(name.text);
    }
  }

  return names;
}

function isSelf(node: SyntaxNode, vocabulary: Vocabulary): boolean {
  return (
    vocabulary.selfTypes.has(node.type) || vocabulary.selfTexts.has(node.text)
  );
}

function isAtom(node: SyntaxNode, vocabulary: Vocabulary): boolean {
  return isLiteral(node.type, vocabulary) || isSelf(node, vocabulary);
}

function unwrapArgument(node: SyntaxNode, vocabulary: Vocabulary): SyntaxNode {
  const first = namedChildrenOf(node)[0];

  if (vocabulary.argumentWrapperTypes.has(node.type) && first) {
    return first;
  }

  return node;
}

function callArguments(call: SyntaxNode, vocabulary: Vocabulary): SyntaxNode[] {
  const isList = (c: SyntaxNode) => vocabulary.argumentListTypes.has(c.type);
  let args = fieldChild(call, vocabulary.fields.arguments);

  args ??= namedChildrenOf(call).find(isList) ?? null;

  if (args === null) {
    const suffix = namedChildrenOf(call).find((c) =>
      vocabulary.callSuffixTypes.has(c.type),
    );

    args =
      suffix === undefined
        ? null
        : (namedChildrenOf(suffix).find(isList) ?? null);
  }

  if (args === null) {
    return [];
  }

  return namedChildrenOf(args)
    .filter((c) => !isComment(c.type, vocabulary))
    .map((c) => unwrapArgument(c, vocabulary));
}

function subscriptAtoms(
  node: SyntaxNode,
  vocabulary: Vocabulary,
): SyntaxNode[] {
  if (vocabulary.subscriptArgumentListTypes.has(node.type)) {
    return namedChildrenOf(node)
      .filter((c) => !isComment(c.type, vocabulary))
      .map((c) => unwrapArgument(c, vocabulary));
  }

  return [node];
}

function lookupChain(start: SyntaxNode, vocabulary: Vocabulary): boolean {
  let node = start;

  for (;;) {
    if (node.childCount === 0) {
      return (
        vocabulary.identifierLeafTypes.has(node.type) ||
        isSelf(node, vocabulary)
      );
    }

    if (vocabulary.selfTypes.has(node.type)) {
      return true;
    }

    const isMember = vocabulary.memberTypes.has(node.type);
    const isSubscript = vocabulary.subscriptTypes.has(node.type);

    if (isMember || isSubscript) {
      const children = namedChildrenOf(node);
      const [head, ...rest] = children;

      if (head === undefined) {
        return false;
      }

      if (
        isSubscript &&
        !rest.every((c) =>
          subscriptAtoms(c, vocabulary).every((a) => isAtom(a, vocabulary)),
        )
      ) {
        return false;
      }

      node = head;

      continue;
    }

    if (vocabulary.callTypes.has(node.type)) {
      const callee =
        fieldChild(node, vocabulary.fields.callee) ??
        namedChildrenOf(node)[0] ??
        null;

      if (
        callee === null ||
        !vocabulary.calleeTypes.has(callee.type) ||
        !callArguments(node, vocabulary).every((a) => isAtom(a, vocabulary))
      ) {
        return false;
      }

      node = callee;

      continue;
    }

    return false;
  }
}

function isAccessorShape(fn: SyntaxNode, vocabulary: Vocabulary): boolean {
  const statements = statementsOf(fn, vocabulary);

  if (statements.length !== 1) {
    return false;
  }

  const statement = statements[0] as SyntaxNode;
  const isJump = vocabulary.jumpTypes.has(statement.type);

  if (
    isJump &&
    !vocabulary.returnKeywords.some((keyword) =>
      statement.text.startsWith(keyword),
    )
  ) {
    return false;
  }

  const expression =
    vocabulary.returnTypes.has(statement.type) || isJump
      ? (namedChildrenOf(statement)[0] ?? null)
      : statement;

  return (
    expression !== null &&
    !vocabulary.expressionStatementTypes.has(expression.type) &&
    lookupChain(expression, vocabulary) &&
    !isBareIdentifier(expression, vocabulary)
  );
}

function isBareIdentifier(node: SyntaxNode, vocabulary: Vocabulary): boolean {
  return (
    vocabulary.identifierTypes.has(node.type) &&
    !vocabulary.selfTypes.has(node.type)
  );
}

function isStoredValue(
  node: SyntaxNode,
  parameters: Set<string>,
  vocabulary: Vocabulary,
): boolean {
  if (isLiteral(node.type, vocabulary)) {
    return true;
  }

  return vocabulary.plainNameTypes.has(node.type) && parameters.has(node.text);
}

function storesAParameter(
  start: SyntaxNode,
  parameters: Set<string>,
  vocabulary: Vocabulary,
): boolean {
  let node = start;

  if (
    vocabulary.expressionStatementTypes.has(node.type) &&
    node.namedChildCount === 1
  ) {
    node = namedChildrenOf(node)[0] as SyntaxNode;
  }

  if (!vocabulary.assignmentTypes.has(node.type)) {
    return false;
  }

  const operator = fieldChild(node, vocabulary.fields.operator);

  if (operator !== null && !vocabulary.assignmentOperators.has(operator.text)) {
    return false;
  }

  let right = fieldChild(node, vocabulary.fields.assigned_value);

  if (
    right === null &&
    vocabulary.positionalAssignmentTypes.has(node.type) &&
    node.childCount >= 3
  ) {
    const children = childrenOf(node);

    if (!vocabulary.assignmentOperators.has((children[1] as SyntaxNode).text)) {
      return false;
    }

    right = children.at(-1) as SyntaxNode;
  }

  return right !== null && isStoredValue(right, parameters, vocabulary);
}

function buildsFromParameters(
  node: SyntaxNode,
  parameters: Set<string>,
  vocabulary: Vocabulary,
): boolean {
  if (!vocabulary.structLiteralTypes.has(node.type)) {
    return false;
  }

  const initialisers = fieldChild(node, vocabulary.fields.initialiser_list);

  if (initialisers === null) {
    return false;
  }

  const fields = namedChildrenOf(initialisers).filter(
    (c) => !isComment(c.type, vocabulary),
  );

  if (
    fields.length === 0 ||
    fields.some(
      (c) =>
        !vocabulary.shorthandInitialiserTypes.has(c.type) &&
        !vocabulary.fieldInitialiserTypes.has(c.type),
    )
  ) {
    return false;
  }

  return fields.every((c) => {
    if (vocabulary.shorthandInitialiserTypes.has(c.type)) {
      return parameters.has(c.text);
    }

    const value = fieldChild(c, vocabulary.fields.initialiser_value);

    return (
      vocabulary.fieldInitialiserTypes.has(c.type) &&
      value !== null &&
      isStoredValue(value, parameters, vocabulary)
    );
  });
}

function isConstructorShape(fn: SyntaxNode, vocabulary: Vocabulary): boolean {
  const statements = statementsOf(fn, vocabulary);

  if (statements.length === 0) {
    return false;
  }

  const parameters = parameterNames(fn, vocabulary);

  if (
    statements.length === 1 &&
    buildsFromParameters(statements[0] as SyntaxNode, parameters, vocabulary)
  ) {
    return true;
  }

  return statements.every((s) => storesAParameter(s, parameters, vocabulary));
}

export function isTrivialShape(
  fn: SyntaxNode,
  vocabulary: Vocabulary,
): boolean {
  return isConstructorShape(fn, vocabulary) || isAccessorShape(fn, vocabulary);
}
