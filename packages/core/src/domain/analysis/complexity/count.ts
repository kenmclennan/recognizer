import type { GrammarRule } from "../duplication/grammars.js";
import { childrenOf, type SyntaxNode } from "../duplication/syntax.js";
import { vocabularyOf } from "../duplication/vocabulary.js";

function addsOne(node: SyntaxNode, rule: GrammarRule): boolean {
  if (rule.branch_types.includes(node.type)) {
    return true;
  }

  if (!vocabularyOf(rule).operatorNodeTypes.has(node.type)) {
    return false;
  }

  const operator = node.childForFieldName("operator");

  return operator !== null && rule.boolean_operators.includes(operator.type);
}

export function cyclomaticComplexity(
  node: SyntaxNode,
  rule: GrammarRule,
  excluded: ReadonlySet<number>,
): number {
  let total = 1;
  const stack = childrenOf(node);

  for (
    let current = stack.pop();
    current !== undefined;
    current = stack.pop()
  ) {
    if (excluded.has(current.id)) {
      continue;
    }

    if (addsOne(current, rule)) {
      total += 1;
    }

    stack.push(...childrenOf(current));
  }

  return total;
}
