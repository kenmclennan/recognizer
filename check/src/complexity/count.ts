import type { Grammar } from "../duplication/grammars.js";
import { childrenOf, type SyntaxNode } from "../duplication/syntax.js";

const TYPESCRIPT_NODES = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_case",
  "catch_clause",
  "ternary_expression",
  "optional_chain",
]);

const NODE_TYPES: Readonly<Record<Grammar, ReadonlySet<string>>> = {
  python: new Set([
    "if_statement",
    "elif_clause",
    "for_statement",
    "while_statement",
    "except_clause",
    "conditional_expression",
    "for_in_clause",
    "if_clause",
    "case_clause",
  ]),
  typescript: TYPESCRIPT_NODES,
  tsx: TYPESCRIPT_NODES,
  kotlin: new Set([
    "if_expression",
    "for_statement",
    "while_statement",
    "do_while_statement",
    "when_entry",
    "catch_block",
    "conjunction_expression",
    "disjunction_expression",
  ]),
  rust: new Set([
    "if_expression",
    "for_expression",
    "while_expression",
    "match_arm",
  ]),
  csharp: new Set([
    "if_statement",
    "for_statement",
    "foreach_statement",
    "while_statement",
    "do_statement",
    "switch_section",
    "switch_expression_arm",
    "catch_clause",
    "conditional_expression",
    "conditional_access_expression",
  ]),
};

const OPERATOR_NODES = new Set(["binary_expression", "boolean_operator"]);

const TYPESCRIPT_OPERATORS = new Set(["&&", "||", "??"]);

const OPERATORS: Readonly<Record<Grammar, ReadonlySet<string>>> = {
  python: new Set(["and", "or"]),
  typescript: TYPESCRIPT_OPERATORS,
  tsx: TYPESCRIPT_OPERATORS,
  kotlin: new Set(),
  rust: new Set(["&&", "||"]),
  csharp: new Set(["&&", "||", "??"]),
};

function addsOne(node: SyntaxNode, grammar: Grammar): boolean {
  if (NODE_TYPES[grammar].has(node.type)) {
    return true;
  }

  if (!OPERATOR_NODES.has(node.type)) {
    return false;
  }

  const operator = node.childForFieldName("operator");

  return operator !== null && OPERATORS[grammar].has(operator.type);
}

export function cyclomaticComplexity(
  node: SyntaxNode,
  grammar: Grammar,
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

    if (addsOne(current, grammar)) {
      total += 1;
    }

    stack.push(...childrenOf(current));
  }

  return total;
}
