import { compareIdentities, identityKey } from "./baseline.js";
import { InputError } from "./errors.js";
import { matchesAny } from "./glob.js";
import { keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";

export type Rule =
  | { type: "level"; from_level: string; to_level: string }
  | { type: "uses"; from_component: string; to_component: string }
  | { type: "forbid"; pattern: string };

export interface Violation {
  from: string;
  to: string;
  kind: string;
  lines: number[];
  rules: Rule[];
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

    if (rules.length === 0) {
      continue;
    }

    const key = identityKey(edge);
    const existing = found.get(key);

    if (existing) {
      existing.lines.push(edge.line);

      for (const rule of rules) {
        if (
          !existing.rules.some(
            (r) => JSON.stringify(r) === JSON.stringify(rule),
          )
        ) {
          existing.rules.push(rule);
        }
      }
    } else {
      found.set(key, {
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        lines: [edge.line],
        rules,
      });
    }
  }

  const violations = [...found.values()].sort(compareIdentities);

  for (const violation of violations) {
    violation.lines = [...new Set(violation.lines)].sort((a, b) => a - b);
  }

  return { violations, unranked: unranked.size };
}
