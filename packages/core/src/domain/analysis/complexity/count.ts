import type { GrammarRule } from "../duplication/grammars.js";
import {
  childrenOf,
  fieldChild,
  type SyntaxNode,
} from "../duplication/syntax.js";
import { vocabularyOf } from "../duplication/vocabulary.js";

function addsOne(node: SyntaxNode, rule: GrammarRule): boolean {
  if (rule.branch_types.includes(node.type)) {
    return true;
  }

  const vocabulary = vocabularyOf(rule);

  if (!vocabulary.operatorNodeTypes.has(node.type)) {
    return false;
  }

  const operator = fieldChild(node, vocabulary.fields.operator);

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
