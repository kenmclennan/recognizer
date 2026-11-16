import { InputError } from "./errors.js";
import { ruleText } from "./findings.js";
import { matchesAny } from "./glob.js";
import { keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";

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

function assignComponents(
  policy: Policy,
  ids: Iterable<string>,
  errors: string[],
) {
  const componentOf = new Map<string, string>();
  const unranked = new Set<string>();

  for (const id of ids) {
    const matching = [...policy.components.keys()].filter((name) =>
      matchesAny(policy.components.get(name) ?? [], id),
    );

    if (matching.length > 1) {
      errors.push(
        `module ${id} matches more than one component: ${matching.join(", ")}`,
      );
    } else if (matching[0] !== undefined) {
      componentOf.set(id, matching[0]);
    } else {
      unranked.add(id);
    }
  }

  return { componentOf, unranked };
}

function checkComponents(
  policy: Policy,
  from: string | undefined,
  to: string | undefined,
): Rule | null {
  if (
    from === undefined ||
    to === undefined ||
    from === to ||
    (policy.levels.length === 0 && policy.uses === null)
  ) {
    return null;
  }

  const fromIndex = policy.levels.indexOf(from);
  const toIndex = policy.levels.indexOf(to);
  const bothRanked = fromIndex >= 0 && toIndex >= 0;

  if (bothRanked && fromIndex >= toIndex) {
    return null;
  }

  if (policy.uses?.get(from)?.includes(to)) {
    return null;
  }

  return bothRanked
    ? { type: "level", from_level: from, to_level: to }
    : { type: "uses", from_component: from, to_component: to };
}

export function collectViolations(scan: Scan, policy: Policy) {
  const { edges, ids } = keptGraph(scan, policy.ignore);

  const errors: string[] = [];
  const { componentOf, unranked } = assignComponents(policy, ids, errors);

  if (errors.length > 0) {
    throw new InputError(errors);
  }

  const found = new Map<string, Violation>();

  for (const edge of edges) {
    if (edge.from === edge.to) {
      continue;
    }

    const rules: Rule[] = [];
    const componentRule = checkComponents(
      policy,
      componentOf.get(edge.from),
      componentOf.get(edge.to),
    );

    if (componentRule) {
      rules.push(componentRule);
    }

    for (const rule of policy.forbid) {
      if (rule.from(edge.from) && rule.to(edge.to)) {
        rules.push({ type: "forbid", pattern: rule.pattern });
      }
    }

    for (const rule of rules) {
      const key = `${edge.from}\u0000${ruleText(rule)}`;
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
      compareText(ruleText(a.rule), ruleText(b.rule)),
  );

  for (const violation of violations) {
    for (const one of violation.imports) {
      one.lines = [...new Set(one.lines)].sort((a, b) => a - b);
    }

    violation.imports.sort(
      (a, b) => compareText(a.to, b.to) || compareText(a.kind, b.kind),
    );
  }

  return { violations, unranked: unranked.size };
}
