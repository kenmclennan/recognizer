import { join } from "node:path";
import type { Io } from "../cli.js";
import { findFunctions } from "../duplication/functions.js";
import { type Grammar, grammarFor } from "../duplication/grammars.js";
import { assignIdentities } from "../duplication/identity.js";
import { decode } from "../duplication/measure.js";
import type { Parsers } from "../duplication/parsers.js";
import { isTestFile } from "../entry-points.js";
import type { FindingRecord } from "../findings-document.js";
import { COMPLEXITY_LIMIT } from "../function-length.js";
import { keptGraph } from "../graph.js";
import type { Policy } from "../policy.js";
import { principleOf } from "../principles.js";
import type { Scan } from "../scan.js";
import type { StructureSettings } from "../structure-sensor.js";
import { cyclomaticComplexity } from "./count.js";

export interface MeasuredFunction {
  identity: string;
  qualified: string;
  startLine: number;
  endLine: number;
  complexity: number;
}

export function measureSource(
  module: string,
  source: string,
  grammar: Grammar,
  parsers: Parsers,
): MeasuredFunction[] {
  const parser = parsers.get(grammar);

  if (parser === undefined) {
    throw new Error(`no ${grammar} parser is loaded for ${module}`);
  }

  const tree = parser.parse(source);

  if (tree === null) {
    return [];
  }

  try {
    const found = findFunctions(tree.rootNode, grammar).filter(
      (one) => !one.node.hasError,
    );
    const ids = new Set(found.map((one) => one.node.id));
    const identities = assignIdentities(
      found.map(
        (one) =>
          [module, one.qualified, one.node.startPosition.row + 1] as const,
      ),
    );

    return found.map((one, index) => {
      const excluded = new Set(ids);

      excluded.delete(one.node.id);

      return {
        identity: identities[index] as string,
        qualified: one.qualified,
        startLine: one.node.startPosition.row + 1,
        endLine: one.node.endPosition.row + 1,
        complexity: cyclomaticComplexity(one.node, grammar, excluded),
      };
    });
  } finally {
    tree.delete();
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function findingOf(
  module: string,
  fn: MeasuredFunction,
  limit: number,
): FindingRecord {
  return {
    id: `complexity:${fn.identity}`,
    kind: "complexity",
    severity: "warning",
    ...principleOf("cyclomatic-complexity-limit"),
    summary: `${fn.qualified} has complexity ${fn.complexity}, over the limit of ${limit}`,
    evidence: {
      modules: [module],
      members: [
        {
          module,
          name: fn.qualified,
          file: module,
          lines: [fn.startLine, fn.endLine],
        },
      ],
      measures: {
        complexity: fn.complexity,
        limit,
        ...(limit === COMPLEXITY_LIMIT ? {} : { published: COMPLEXITY_LIMIT }),
      },
    },
  };
}

export interface ComplexityMeasure {
  findings: FindingRecord[];
  values: Record<string, number>;
}

export function measureComplexityValues(
  io: Io,
  root: string,
  scans: Scan[],
  policy: Policy | null,
  settings: StructureSettings,
  parsers: Parsers,
): ComplexityMeasure {
  const limit = settings.complexity_limit;
  const findings: FindingRecord[] = [];
  const values: Record<string, number> = {};

  for (const scan of scans) {
    const { ids } = keptGraph(scan, policy?.ignore ?? []);

    for (const module of scan.modules) {
      const grammar = grammarFor(module.id);

      if (grammar === null || !ids.has(module.id) || isTestFile(module.id)) {
        continue;
      }

      let bytes: Buffer;

      try {
        bytes = io.readBytes(join(root, module.id));
      } catch {
        continue;
      }

      const source = decode(io, module.id, bytes, "complexity");

      if (source === null) {
        continue;
      }

      for (const fn of measureSource(module.id, source, grammar, parsers)) {
        const key = `${module.id}::${fn.qualified}`;

        values[key] = Math.max(values[key] ?? 0, fn.complexity);

        if (fn.complexity > limit) {
          findings.push(findingOf(module.id, fn, limit));
        }
      }
    }
  }

  const seen = new Set<string>();

  return {
    findings: findings
      .filter((finding) => !seen.has(finding.id) && seen.add(finding.id))
      .sort((a, b) => compare(a.id, b.id)),
    values,
  };
}

export function measureComplexity(
  io: Io,
  root: string,
  scans: Scan[],
  policy: Policy | null,
  settings: StructureSettings,
  parsers: Parsers,
): FindingRecord[] {
  return measureComplexityValues(io, root, scans, policy, settings, parsers)
    .findings;
}
