import {
  childrenOf,
  fieldChild,
  namedChildrenOf,
  type SyntaxNode,
} from "./syntax.js";
import type { Vocabulary } from "./vocabulary.js";

const IDENTIFIER_TOKEN = "ID";
const LITERAL_TOKEN = "LIT";

export type Normalised = readonly [string, readonly Normalised[]];

export function isComment(nodeType: string, vocabulary: Vocabulary): boolean {
  return vocabulary.commentMarkers.some((marker) => nodeType.includes(marker));
}

export function isLiteral(nodeType: string, vocabulary: Vocabulary): boolean {
  return (
    vocabulary.literalSuffixes.some((suffix) => nodeType.endsWith(suffix)) ||
    vocabulary.literalTypes.has(nodeType)
  );
}

function isIdentifier(node: SyntaxNode, vocabulary: Vocabulary): boolean {
  return (
    node.childCount === 0 &&
    (vocabulary.identifierTypes.has(node.type) ||
      vocabulary.identifierSuffixes.some((suffix) =>
        node.type.endsWith(suffix),
      ))
  );
}

function calleeOf(call: SyntaxNode, vocabulary: Vocabulary): SyntaxNode | null {
  const named = fieldChild(call, vocabulary.fields.callee);

  if (named !== null) {
    return named;
  }

  return namedChildrenOf(call)[0] ?? null;
}

function finalName(
  start: SyntaxNode,
  vocabulary: Vocabulary,
): SyntaxNode | null {
  let node = start;

  for (;;) {
    if (node.childCount === 0) {
      return node;
    }

    if (!vocabulary.memberFields.has(node.type)) {
      return null;
    }

    const field = vocabulary.memberFields.get(node.type) as string | null;
    let target = field === null ? null : node.childForFieldName(field);

    if (target === null) {
      target = namedChildrenOf(node).at(-1) ?? null;
    }

    if (target === null) {
      return null;
    }

    node = target;
  }
}

const DESCEND = Symbol("descend");

function visit(
  node: SyntaxNode,
  kept: Set<number>,
  vocabulary: Vocabulary,
): Normalised | null | typeof DESCEND {
  const nodeType = node.type;

  if (isComment(nodeType, vocabulary)) {
    return null;
  }

  if (isLiteral(nodeType, vocabulary)) {
    return [LITERAL_TOKEN, []];
  }

  if (vocabulary.callTypes.has(nodeType)) {
    const callee = calleeOf(node, vocabulary);
    const leaf = callee === null ? null : finalName(callee, vocabulary);

    if (leaf !== null) {
      kept.add(leaf.id);
    }
  }

  if (isIdentifier(node, vocabulary)) {
    return [kept.has(node.id) ? node.text : IDENTIFIER_TOKEN, []];
  }

  if (node.childCount === 0) {
    return [nodeType, []];
  }

  return DESCEND;
}

interface Frame {
  type: string;
  remaining: SyntaxNode[];
  position: number;
  done: Normalised[];
}

export function normalise(
  root: SyntaxNode,
  kept: Set<number>,
  vocabulary: Vocabulary,
): Normalised | null {
  const first = visit(root, kept, vocabulary);

  if (first !== DESCEND) {
    return first;
  }

  const stack: Frame[] = [
    { type: root.type, remaining: childrenOf(root), position: 0, done: [] },
  ];

  for (;;) {
    const frame = stack.at(-1) as Frame;

    if (frame.position < frame.remaining.length) {
      const child = frame.remaining[frame.position] as SyntaxNode;

      frame.position += 1;

      const result = visit(child, kept, vocabulary);

      if (result === DESCEND) {
        stack.push({
          type: child.type,
          remaining: childrenOf(child),
          position: 0,
          done: [],
        });
      } else if (result !== null) {
        frame.done.push(result);
      }

      continue;
    }

    stack.pop();

    const built: Normalised = [frame.type, frame.done];
    const parent = stack.at(-1);

    if (parent === undefined) {
      return built;
    }

    parent.done.push(built);
  }
}

export function countNodes(root: SyntaxNode): number {
  let count = 0;
  const stack: SyntaxNode[] = [root];

  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    count += 1;
    stack.push(...childrenOf(node));
  }

  return count;
}
