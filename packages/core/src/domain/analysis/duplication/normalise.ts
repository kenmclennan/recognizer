import { childrenOf, namedChildrenOf, type SyntaxNode } from "./syntax.js";

const LITERAL_TYPES = new Set([
  "string",
  "string_fragment",
  "string_content",
  "template_string",
  "number",
  "integer",
  "float",
  "true",
  "false",
  "none",
  "null",
  "undefined",
  "regex",
]);

const CALL_TYPES = new Set([
  "call",
  "call_expression",
  "invocation_expression",
]);

const MEMBER_FIELDS: Readonly<Record<string, string | null>> = {
  attribute: "attribute",
  member_expression: "property",
  member_access_expression: "name",
  field_expression: "field",
  scoped_identifier: "name",
  scoped_expression: "name",
  navigation_expression: null,
  navigation_suffix: null,
};

const IDENTIFIER_TOKEN = "ID";
const LITERAL_TOKEN = "LIT";

export type Normalised = readonly [string, readonly Normalised[]];

export function isComment(nodeType: string): boolean {
  return nodeType.includes("comment");
}

export function isLiteral(nodeType: string): boolean {
  return nodeType.endsWith("_literal") || LITERAL_TYPES.has(nodeType);
}

function isIdentifier(node: SyntaxNode): boolean {
  return (
    node.childCount === 0 &&
    (node.type === "identifier" ||
      node.type.endsWith("_identifier") ||
      node.type === "self")
  );
}

function calleeOf(call: SyntaxNode): SyntaxNode | null {
  const named = call.childForFieldName("function");

  if (named !== null) {
    return named;
  }

  return namedChildrenOf(call)[0] ?? null;
}

function finalName(start: SyntaxNode): SyntaxNode | null {
  let node = start;

  for (;;) {
    if (node.childCount === 0) {
      return node;
    }

    if (!Object.hasOwn(MEMBER_FIELDS, node.type)) {
      return null;
    }

    const field = MEMBER_FIELDS[node.type] as string | null;
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
): Normalised | null | typeof DESCEND {
  const nodeType = node.type;

  if (isComment(nodeType)) {
    return null;
  }

  if (isLiteral(nodeType)) {
    return [LITERAL_TOKEN, []];
  }

  if (CALL_TYPES.has(nodeType)) {
    const callee = calleeOf(node);
    const leaf = callee === null ? null : finalName(callee);

    if (leaf !== null) {
      kept.add(leaf.id);
    }
  }

  if (isIdentifier(node)) {
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
): Normalised | null {
  const first = visit(root, kept);

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

      const result = visit(child, kept);

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
