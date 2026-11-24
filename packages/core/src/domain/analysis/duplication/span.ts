import {
  type GrammarRule,
  type SpanVocabulary,
  spanVocabularyOf,
} from "./grammars.js";
import { isComment } from "./normalise.js";
import { bodyOf } from "./shapes.js";
import { childrenOf, namedChildrenOf, type SyntaxNode } from "./syntax.js";

export interface ComparedSpan {
  node: SyntaxNode;
  lines: number;
}

function linesOf(node: SyntaxNode): number {
  return node.endPosition.row - node.startPosition.row + 1;
}

function statementsIn(
  container: SyntaxNode,
  span: SpanVocabulary,
): SyntaxNode[] {
  const named = namedChildrenOf(container);
  const block = named.find((child) => child.type === span.statements);

  return (block === undefined ? named : namedChildrenOf(block)).filter(
    (child) => !isComment(child.type),
  );
}

function calleeName(call: SyntaxNode, span: SpanVocabulary): string | null {
  const callee = call.firstChild;

  if (callee === null) {
    return null;
  }

  if (callee.type === span.calleeName) {
    return callee.text;
  }

  if (callee.type === span.navigation) {
    const suffix = namedChildrenOf(callee).at(-1);

    return suffix?.type === span.navigationSuffix
      ? (namedChildrenOf(suffix).at(-1)?.text ?? null)
      : null;
  }

  return null;
}

function lambdaStatements(
  call: SyntaxNode,
  span: SpanVocabulary,
): SyntaxNode | null {
  const suffix = childrenOf(call).find(
    (child) => child.type === span.callSuffix,
  );
  const lambda = suffix
    ? childrenOf(suffix).find((child) => child.type === span.lambdaArgument)
    : undefined;
  const literal = lambda
    ? childrenOf(lambda).find((child) => child.type === span.lambda)
    : undefined;

  if (literal === undefined) {
    return null;
  }

  const block = childrenOf(literal).find(
    (child) => child.type === span.statements,
  );

  return block !== undefined && statementsIn(literal, span).length > 0
    ? block
    : null;
}

function soleCall(
  statements: SyntaxNode[],
  span: SpanVocabulary,
): SyntaxNode | null {
  const only = statements.length === 1 ? (statements[0] as SyntaxNode) : null;

  if (only === null) {
    return null;
  }

  if (only.type === span.call) {
    return only;
  }

  if (only.type !== span.jump) {
    return null;
  }

  const first = only.firstChild?.type ?? "";

  if (!span.jumpReturns.includes(first)) {
    return null;
  }

  const operands = namedChildrenOf(only).filter(
    (child) => child.type !== span.label && !isComment(child.type),
  );
  const operand = operands.length === 1 ? (operands[0] as SyntaxNode) : null;

  return operand?.type === span.call ? operand : null;
}

function unwrap(container: SyntaxNode, span: SpanVocabulary): SyntaxNode {
  let current = container;

  for (;;) {
    const call = soleCall(statementsIn(current, span), span);
    const name = call === null ? null : calleeName(call, span);
    const inner =
      call !== null && name !== null && span.scopeCalls.has(name)
        ? lambdaStatements(call, span)
        : null;

    if (inner === null) {
      return current;
    }

    current = inner;
  }
}

function expressionInterior(
  body: SyntaxNode,
  span: SpanVocabulary,
): SyntaxNode | null {
  if (body.type !== span.functionBody) {
    return null;
  }

  const expression = namedChildrenOf(body)
    .filter((child) => !isComment(child.type))
    .at(-1);

  if (expression?.type === span.objectLiteral) {
    return (
      childrenOf(expression).find((child) => child.type === span.objectBody) ??
      null
    );
  }

  if (expression?.type === span.lambda) {
    return (
      childrenOf(expression).find((child) => child.type === span.statements) ??
      null
    );
  }

  return null;
}

export function comparedSpan(
  fn: SyntaxNode,
  rule: GrammarRule,
): ComparedSpan | null {
  const body = bodyOf(fn);

  if (body === null) {
    return null;
  }

  if (rule.span === null) {
    return { node: body, lines: linesOf(fn) };
  }

  const span = spanVocabularyOf(rule.span);
  const node = unwrap(expressionInterior(body, span) ?? body, span);

  return { node, lines: linesOf(node) };
}
