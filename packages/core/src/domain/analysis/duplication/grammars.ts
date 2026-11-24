export type Grammar = string;

export interface GrammarRule {
  name: Grammar;
  extensions: readonly string[];
  function_types: readonly string[];
  scope_types: readonly string[];
  branch_types: readonly string[];
  boolean_operators: readonly string[];
  bound_function_types: readonly string[];
}

export function grammarFor(
  path: string,
  rules: readonly GrammarRule[],
): GrammarRule | null {
  const dot = path.lastIndexOf(".");

  if (dot === -1) {
    return null;
  }

  const extension = path.slice(dot).toLowerCase();

  return rules.find((rule) => rule.extensions.includes(extension)) ?? null;
}
