import type { FunctionNameRule, GrammarRule } from "./grammars.js";
import { childrenOf, fieldChild, type SyntaxNode } from "./syntax.js";
import { type Vocabulary, vocabularyOf } from "./vocabulary.js";

export interface FoundFunction {
  node: SyntaxNode;
  qualified: string;
}

function textOf(node: SyntaxNode | null): string | null {
  return node === null ? null : node.text;
}

function nodeName(node: SyntaxNode, vocabulary: Vocabulary): string | null {
  const named = fieldChild(node, vocabulary.fields.name);

  if (named !== null) {
    return named.text;
  }

  const rule = vocabulary.nodeNames.get(node.type);

  if (rule?.name_field !== undefined) {
    const field = node.childForFieldName(rule.name_field);

    if (field === null) {
      return null;
    }

    return rule.strip_after === undefined
      ? field.text
      : (field.text.split(rule.strip_after)[0] as string);
  }

  if (rule?.literal !== undefined) {
    return rule.literal;
  }

  const leaf = childrenOf(node).find((child) =>
    vocabulary.nameLeafTypes.has(child.type),
  );

  if (leaf !== undefined) {
    return leaf.text;
  }

  return rule?.default ?? null;
}

function boundName(node: SyntaxNode, vocabulary: Vocabulary): string | null {
  const parent = node.parent;

  if (parent === null || !vocabulary.bindingDeclaratorTypes.has(parent.type)) {
    return null;
  }

  const value = fieldChild(parent, vocabulary.fields.bound_value);
  const name = fieldChild(parent, vocabulary.fields.name);

  if (
    value === null ||
    value.id !== node.id ||
    name === null ||
    !vocabulary.bindingNameTypes.has(name.type)
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

function functionName(
  node: SyntaxNode,
  rule: GrammarRule,
  vocabulary: Vocabulary,
): string | null {
  if (rule.function_types.includes(node.type)) {
    const naming = rule.function_names.find((one) => one.type === node.type);

    return naming === undefined
      ? nodeName(node, vocabulary)
      : namedByRule(node, naming);
  }

  if (rule.bound_function_types.includes(node.type)) {
    return boundName(node, vocabulary);
  }

  return null;
}

export function findFunctions(
  root: SyntaxNode,
  rule: GrammarRule,
): FoundFunction[] {
  const found: FoundFunction[] = [];
  const scopeTypes = new Set(rule.scope_types);
  const vocabulary = vocabularyOf(rule);
  const stack: [SyntaxNode, readonly string[]][] = [[root, []]];

  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const [node, scope] = entry;
    let inner = scope;
    const name = functionName(node, rule, vocabulary);

    if (name !== null) {
      found.push({ node, qualified: [...scope, name].join(".") });
      inner = [...scope, name];
    } else if (scopeTypes.has(node.type)) {
      const scopeName = nodeName(node, vocabulary);

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
