import type { Repository } from "@recognizer/core";
import { findingRuleOf } from "./adapters/filesystem/findings-translator.js";
import { ruleText } from "./findings.js";
import { keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";

export type Rule =
  | { type: "level"; from_level: string; to_level: string }
  | { type: "uses"; from_component: string; to_component: string }
  | { type: "forbid"; pattern: string };

export interface ViolationImport {
  to: string;
  kind: string;
  lines: number[];
}

export interface Violation {
  from: string;
  rule: Rule;
  imports: ViolationImport[];
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

export function collectViolations(repository: Repository, policy: Policy) {
  const { edges } = keptGraph(repository, policy.ignore);

  const found = new Map<string, Violation>();

  for (const edge of edges) {
    if (edge.from === edge.to) {
      continue;
    }

    const rules: Rule[] = [];

    for (const rule of policy.forbid) {
      if (rule.from(edge.from) && rule.to(edge.to)) {
        rules.push({ type: "forbid", pattern: rule.pattern });
      }
    }

    for (const rule of rules) {
      const key = `${edge.from}\u0000${ruleText(findingRuleOf(rule))}`;
      let group = found.get(key);

      if (group === undefined) {
        group = { from: edge.from, rule, imports: [] };
        found.set(key, group);
      }

      const existing = group.imports.find(
        (one) => one.to === edge.to && one.kind === edge.kind,
      );

      if (existing) {
        existing.lines.push(edge.line);
      } else {
        group.imports.push({
          to: edge.to,
          kind: edge.kind,
          lines: [edge.line],
        });
      }
    }
  }

  const violations = [...found.values()].sort(
    (a, b) =>
      compareText(a.from, b.from) ||
      compareText(
        ruleText(findingRuleOf(a.rule)),
        ruleText(findingRuleOf(b.rule)),
      ),
  );

  for (const violation of violations) {
    for (const one of violation.imports) {
      one.lines = [...new Set(one.lines)].sort((a, b) => a - b);
    }

    violation.imports.sort(
      (a, b) => compareText(a.to, b.to) || compareText(a.kind, b.kind),
    );
  }

  return { violations };
}
