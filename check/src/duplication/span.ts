import type { Grammar } from "./grammars.js";
import { isComment } from "./normalise.js";
import { bodyOf } from "./shapes.js";
import { childrenOf, namedChildrenOf, type SyntaxNode } from "./syntax.js";

export const KOTLIN_SCOPE_CALLS: ReadonlySet<string> = new Set([
  "synchronized",
  "use",
  "withLock",
  "runCatching",
  "run",
  "with",
  "apply",
  "also",
  "let",
]);

export interface ComparedSpan {
  node: SyntaxNode;
  lines: number;
}

function linesOf(node: SyntaxNode): number {
  return node.endPosition.row - node.startPosition.row + 1;
}

function statementsIn(container: SyntaxNode): SyntaxNode[] {
  const named = namedChildrenOf(container);
  const block = named.find((child) => child.type === "statements");

  return (block === undefined ? named : namedChildrenOf(block)).filter(
    (child) => !isComment(child.type),
  );
}

function calleeName(call: SyntaxNode): string | null {
  const callee = call.firstChild;

  if (callee === null) {
    return null;
  }

  if (callee.type === "simple_identifier") {
    return callee.text;
  }

  if (callee.type === "navigation_expression") {
    const suffix = namedChildrenOf(callee).at(-1);

    return suffix?.type === "navigation_suffix"
      ? (namedChildrenOf(suffix).at(-1)?.text ?? null)
      : null;
  }

  return null;
}

function lambdaStatements(call: SyntaxNode): SyntaxNode | null {
  const suffix = childrenOf(call).find((child) => child.type === "call_suffix");
  const lambda = suffix
    ? childrenOf(suffix).find((child) => child.type === "annotated_lambda")
    : undefined;
  const literal = lambda
    ? childrenOf(lambda).find((child) => child.type === "lambda_literal")
    : undefined;

  if (literal === undefined) {
    return null;
  }

  const block = childrenOf(literal).find(
    (child) => child.type === "statements",
  );

  return block !== undefined && statementsIn(literal).length > 0 ? block : null;
}

function soleCall(statements: SyntaxNode[]): SyntaxNode | null {
  const only = statements.length === 1 ? (statements[0] as SyntaxNode) : null;

  if (only === null) {
    return null;
  }

  if (only.type === "call_expression") {
    return only;
  }

  if (only.type !== "jump_expression") {
    return null;
  }

  const first = only.firstChild?.type ?? "";

  if (first !== "return" && first !== "return@") {
    return null;
  }

  const operands = namedChildrenOf(only).filter(
    (child) => child.type !== "label" && !isComment(child.type),
  );
  const operand = operands.length === 1 ? (operands[0] as SyntaxNode) : null;

  return operand?.type === "call_expression" ? operand : null;
}

function unwrap(container: SyntaxNode): SyntaxNode {
  let current = container;

  for (;;) {
    const call = soleCall(statementsIn(current));
    const name = call === null ? null : calleeName(call);
    const inner =
      call !== null && name !== null && KOTLIN_SCOPE_CALLS.has(name)
        ? lambdaStatements(call)
        : null;

    if (inner === null) {
      return current;
    }

    current = inner;
  }
}

function expressionInterior(body: SyntaxNode): SyntaxNode | null {
  if (body.type !== "function_body") {
    return null;
  }

  const expression = namedChildrenOf(body)
    .filter((child) => !isComment(child.type))
    .at(-1);

  if (expression?.type === "object_literal") {
    return (
      childrenOf(expression).find((child) => child.type === "class_body") ??
      null
    );
  }

  if (expression?.type === "lambda_literal") {
    return (
      childrenOf(expression).find((child) => child.type === "statements") ??
      null
    );
  }

  return null;
}

export function comparedSpan(
  fn: SyntaxNode,
  grammar: Grammar,
): ComparedSpan | null {
  const body = bodyOf(fn);

  if (body === null) {
    return null;
  }

  if (grammar !== "kotlin") {
    return { node: body, lines: linesOf(fn) };
  }

  const node = unwrap(expressionInterior(body) ?? body);

  return { node, lines: linesOf(node) };
}
