import type { GrammarRule } from "./grammars.js";
import { childrenOf, type SyntaxNode } from "./syntax.js";

const CSHARP_PROPERTY_TYPES = new Set([
  "property_declaration",
  "indexer_declaration",
]);

const NAME_LEAF_TYPES = new Set([
  "identifier",
  "type_identifier",
  "property_identifier",
  "simple_identifier",
]);

export interface FoundFunction {
  node: SyntaxNode;
  qualified: string;
}

function textOf(node: SyntaxNode | null): string | null {
  return node === null ? null : node.text;
}

function nodeName(node: SyntaxNode): string | null {
  const named = node.childForFieldName("name");

  if (named !== null) {
    return named.text;
  }

  if (node.type === "impl_item") {
    const target = node.childForFieldName("type");

    return target === null ? null : (target.text.split("<")[0] as string);
  }

  if (node.type === "indexer_declaration") {
    return "this";
  }

  const leaf = childrenOf(node).find((child) =>
    NAME_LEAF_TYPES.has(child.type),
  );

  if (node.type === "companion_object") {
    return leaf === undefined ? "Companion" : leaf.text;
  }

  return leaf === undefined ? null : leaf.text;
}

function boundName(node: SyntaxNode): string | null {
  const parent = node.parent;

  if (parent === null || parent.type !== "variable_declarator") {
    return null;
  }

  const value = parent.childForFieldName("value");
  const name = parent.childForFieldName("name");

  if (
    value === null ||
    value.id !== node.id ||
    name === null ||
    name.type !== "identifier"
  ) {
    return null;
  }

  return name.text;
}

function csharpName(node: SyntaxNode): string | null {
  const kind = node.type;

  if (CSHARP_PROPERTY_TYPES.has(kind)) {
    const value = node.childForFieldName("value");

    if (value === null || value.type !== "arrow_expression_clause") {
      return null;
    }

    return kind === "indexer_declaration"
      ? "this"
      : textOf(node.childForFieldName("name"));
  }

  if (node.childForFieldName("body") === null) {
    return null;
  }

  if (kind === "accessor_declaration") {
    return textOf(node.childForFieldName("name"));
  }

  if (kind === "destructor_declaration") {
    return `~${textOf(node.childForFieldName("name")) ?? ""}`;
  }

  if (kind === "operator_declaration") {
    return `operator ${textOf(node.childForFieldName("operator")) ?? ""}`;
  }

  if (kind === "conversion_operator_declaration") {
    return `operator ${textOf(node.childForFieldName("type")) ?? ""}`;
  }

  return textOf(node.childForFieldName("name"));
}

function functionName(node: SyntaxNode, rule: GrammarRule): string | null {
  if (rule.function_types.includes(node.type)) {
    return rule.name === "csharp" ? csharpName(node) : nodeName(node);
  }

  if (rule.bound_function_types.includes(node.type)) {
    return boundName(node);
  }

  return null;
}

export function findFunctions(
  root: SyntaxNode,
  rule: GrammarRule,
): FoundFunction[] {
  const found: FoundFunction[] = [];
  const scopeTypes = new Set(rule.scope_types);
  const stack: [SyntaxNode, readonly string[]][] = [[root, []]];

  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const [node, scope] = entry;
    let inner = scope;
    const name = functionName(node, rule);

    if (name !== null) {
      found.push({ node, qualified: [...scope, name].join(".") });
      inner = [...scope, name];
    } else if (scopeTypes.has(node.type)) {
      const scopeName = nodeName(node);

      if (scopeName !== null) {
        inner = [...scope, scopeName];
      }
    }

    const children = childrenOf(node);

    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push([children[i] as SyntaxNode, inner]);
    }
  }

  return found;
}
