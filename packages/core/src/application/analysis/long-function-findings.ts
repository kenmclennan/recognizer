import { isTestFile } from "../../domain/analysis/entry-points.js";
import { Finding } from "../../domain/finding.js";
import { LONG_FUNCTION, measuredLength } from "../../domain/function-length.js";
import type { Member } from "../../domain/member.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import { principleOf } from "../../domain/principles.js";
import type { Repository } from "../../domain/repository.js";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface MeasuredFunction {
  qualified: string;
  line?: number;
  endLine?: number;
  bodyLine?: number;
}

function functionsOf(members: readonly Member[]): MeasuredFunction[] {
  const functions: MeasuredFunction[] = [];

  for (const member of members) {
    if (member.kind === "function") {
      functions.push({
        qualified: member.name,
        line: member.line,
        endLine: member.endLine,
        bodyLine: member.bodyLine,
      });

      continue;
    }

    for (const method of member.methods ?? []) {
      functions.push({
        qualified: `${member.name}.${method.name}`,
        line: method.line,
        endLine: method.endLine,
        bodyLine: method.bodyLine,
      });
    }
  }

  return functions;
}

export function functionLengths(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): Record<string, number> {
  const lengths: Record<string, number> = {};
  const { ids } = repository.graphKeeping(policy);

  for (const file of repository.files) {
    if (!ids.has(file.path) || isTestFile(file.path)) {
      continue;
    }

    for (const fn of functionsOf(file.members)) {
      const length = measuredLength(fn.line, fn.bodyLine, fn.endLine);

      if (length === null) {
        continue;
      }

      const key = `${file.path}::${fn.qualified}`;

      lengths[key] = Math.max(lengths[key] ?? 0, length);
    }
  }

  return lengths;
}

export function longFunctionFindings(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  limit: number = LONG_FUNCTION,
): Finding[] {
  const { ids } = repository.graphKeeping(policy);
  const findings: Finding[] = [];

  for (const module of repository.files) {
    if (!ids.has(module.path) || isTestFile(module.path)) {
      continue;
    }

    const functions = functionsOf(module.members);
    const counts = new Map<string, number>();

    for (const fn of functions) {
      counts.set(fn.qualified, (counts.get(fn.qualified) ?? 0) + 1);
    }

    for (const fn of functions) {
      const length = measuredLength(fn.line, fn.bodyLine, fn.endLine);

      if (
        length === null ||
        length <= limit ||
        fn.line === undefined ||
        fn.endLine === undefined
      ) {
        continue;
      }

      const identity =
        (counts.get(fn.qualified) ?? 0) > 1
          ? `${module.path}::${fn.qualified}@${fn.line}`
          : `${module.path}::${fn.qualified}`;

      findings.push(
        Finding.stored({
          id: `long_function:${identity}`,
          kind: "long_function",
          severity: "warning",
          ...principleOf("small-functions"),
          summary:
            fn.bodyLine === undefined
              ? `${fn.qualified} is ${length} lines, over the limit of ${limit}`
              : `${fn.qualified} has a ${length}-line body, over the limit of ${limit}`,
          files: [module.path],
          members: [
            {
              file: module.path,
              name: fn.qualified,
              sourceFile: module.path,
              lines: [fn.line, fn.endLine],
            },
          ],
          measures: {
            lines: length,
            limit,
            ...(fn.bodyLine === undefined ? {} : { body_line: fn.bodyLine }),
            ...(limit === LONG_FUNCTION ? {} : { published: LONG_FUNCTION }),
          },
        }),
      );
    }
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}
