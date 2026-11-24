import type { FunctionNameRule, GrammarRule } from "./grammars.js";
import { childrenOf, type SyntaxNode } from "./syntax.js";

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

function namedByRule(node: SyntaxNode, rule: FunctionNameRule): string | null {
  if (rule.requires_field !== undefined) {
    const required = node.childForFieldName(rule.requires_field);

    if (required === null) {
      return null;
    }

    if (
      rule.requires_field_type !== undefined &&
      required.type !== rule.requires_field_type
    ) {
      return null;
    }
  }

  const base =
    rule.literal !== undefined
      ? rule.literal
      : rule.name_field === undefined
        ? null
        : textOf(node.childForFieldName(rule.name_field));

  return rule.prefix === undefined ? base : `${rule.prefix}${base ?? ""}`;
}

function functionName(node: SyntaxNode, rule: GrammarRule): string | null {
  if (rule.function_types.includes(node.type)) {
    const naming = rule.function_names.find((one) => one.type === node.type);

    return naming === undefined ? nodeName(node) : namedByRule(node, naming);
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
