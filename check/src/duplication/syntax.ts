import type { Node } from "web-tree-sitter";

export type SyntaxNode = Node;

export function childrenOf(node: SyntaxNode): SyntaxNode[] {
  return node.children.filter((child): child is SyntaxNode => child !== null);
}

export function namedChildrenOf(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter(
    (child): child is SyntaxNode => child !== null,
  );
}

export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) as number;
    const y = b.codePointAt(j) as number;

    if (x !== y) {
      return x < y ? -1 : 1;
    }

    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }

  if (i < a.length) {
    return 1;
  }

  return j < b.length ? -1 : 0;
}
