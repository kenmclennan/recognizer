export interface SyntaxPoint {
  readonly row: number;
}

export interface SyntaxNode {
  readonly id: number;
  readonly firstChild: SyntaxNode | null;
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: SyntaxPoint;
  readonly endPosition: SyntaxPoint;
  readonly hasError: boolean;
  readonly parent: SyntaxNode | null;
  readonly childCount: number;
  readonly namedChildCount: number;
  readonly children: readonly (SyntaxNode | null)[];
  readonly namedChildren: readonly (SyntaxNode | null)[];
  childForFieldName(name: string): SyntaxNode | null;
}

export interface SyntaxTree {
  delete(): void;
  readonly rootNode: SyntaxNode;
}

export interface SyntaxParser {
  parse(source: string): SyntaxTree | null;
}

export function fieldChild(
  node: SyntaxNode,
  field: string | null,
): SyntaxNode | null {
  return field === null ? null : node.childForFieldName(field);
}

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
