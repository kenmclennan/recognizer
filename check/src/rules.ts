import { compareIdentities, identityKey } from "./baseline.js";
import { InputError } from "./errors.js";
import { matchesAny } from "./glob.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";

export type Rule =
  | { type: "level"; from_level: string; to_level: string }
  | { type: "forbid"; pattern: string };

export interface Violation {
  from: string;
  to: string;
  kind: string;
  lines: number[];
  rules: Rule[];
}

const FOREIGN_PREFIX = "foreign:";

function isForeign(id: string): boolean {
  return id.startsWith(FOREIGN_PREFIX);
}

function assignLevels(policy: Policy, ids: Iterable<string>, errors: string[]) {
  const levelOf = new Map<string, string>();
  const unranked = new Set<string>();

  for (const id of ids) {
    const matching = policy.levels.filter((level) =>
      matchesAny(policy.modules.get(level) ?? [], id),
    );

    if (matching.length > 1) {
      errors.push(
        `module ${id} matches more than one level: ${matching.join(", ")}`,
      );
    } else if (matching[0] !== undefined) {
      levelOf.set(id, matching[0]);
    } else {
      unranked.add(id);
    }
  }

  return { levelOf, unranked };
}

export function collectViolations(scan: Scan, policy: Policy) {
  const dropped = (id: string) =>
    !isForeign(id) && matchesAny(policy.ignore, id);

  const ids = new Set<string>();

  for (const module of scan.modules) {
    if (!dropped(module.id)) {
      ids.add(module.id);
    }
  }

  const edges = scan.edges.filter(
    (edge) => !dropped(edge.from) && !dropped(edge.to),
  );

  for (const edge of edges) {
    ids.add(edge.from);

    if (!isForeign(edge.to)) {
      ids.add(edge.to);
    }
  }

  const errors: string[] = [];
  const { levelOf, unranked } = assignLevels(policy, ids, errors);

  if (errors.length > 0) {
    throw new InputError(errors);
  }

  const found = new Map<string, Violation>();

  for (const edge of edges) {
    if (edge.from === edge.to) {
      continue;
    }

    const rules: Rule[] = [];
    const fromLevel = levelOf.get(edge.from);
    const toLevel = levelOf.get(edge.to);

    if (fromLevel !== undefined && toLevel !== undefined) {
      if (policy.levels.indexOf(fromLevel) < policy.levels.indexOf(toLevel)) {
        rules.push({ type: "level", from_level: fromLevel, to_level: toLevel });
      }
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
