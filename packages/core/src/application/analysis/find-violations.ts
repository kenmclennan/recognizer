import type { Violation } from "../../domain/analysis/violation.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import { compilePolicy } from "./compile-policy.js";
import { keptGraph } from "./graph.js";

interface Group {
  file: string;
  rule: Violation["rule"];
  dependencies: { to: string; kind: string; lines: number[] }[];
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

export function findViolations(
  repository: Repository,
  rules: readonly PolicyRule[],
): Violation[] {
  const policy = compilePolicy(rules);
  const { edges } = keptGraph(repository, policy.ignore);
  const found = new Map<string, Group>();

  for (const edge of edges) {
    if (edge.from === edge.to) {
      continue;
    }

    for (const rule of policy.forbid) {
      if (!(rule.from(edge.from) && rule.to(edge.to))) {
        continue;
      }

      const key = `${edge.from}\u0000forbid ${rule.pattern}`;
      let group = found.get(key);

      if (group === undefined) {
        group = {
          file: edge.from,
          rule: { type: "forbid", pattern: rule.pattern },
          dependencies: [],
        };
        found.set(key, group);
      }

      const existing = group.dependencies.find(
        (one) => one.to === edge.to && one.kind === edge.kind,
      );

      if (existing) {
        existing.lines.push(edge.line);
      } else {
        group.dependencies.push({
          to: edge.to,
          kind: edge.kind,
          lines: [edge.line],
        });
      }
    }
  }

  const textOf = (group: Group) =>
    group.rule.type === "forbid" ? `forbid ${group.rule.pattern}` : "";

  return [...found.values()]
    .sort(
      (a, b) =>
        compareText(a.file, b.file) || compareText(textOf(a), textOf(b)),
    )
    .map((group) => ({
      file: group.file,
      rule: group.rule,
      dependencies: group.dependencies
        .map((one) => ({
          to: one.to,
          kind: one.kind,
          lines: [...new Set(one.lines)].sort((a, b) => a - b),
        }))
        .sort((a, b) => compareText(a.to, b.to) || compareText(a.kind, b.kind)),
    }));
}
