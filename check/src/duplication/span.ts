import type { Grammar } from "./grammars.js";
import { bodyOf } from "./shapes.js";
import type { SyntaxNode } from "./syntax.js";

export interface ComparedSpan {
  node: SyntaxNode;
  lines: number;
}

function linesOf(node: SyntaxNode): number {
  return node.endPosition.row - node.startPosition.row + 1;
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

  return { node: body, lines: linesOf(body) };
}
