import { cyclomaticComplexity } from "../../domain/analysis/complexity/count.js";
import { findFunctions } from "../../domain/analysis/duplication/functions.js";
import {
  type Grammar,
  grammarFor,
} from "../../domain/analysis/duplication/grammars.js";
import { assignIdentities } from "../../domain/analysis/duplication/identity.js";
import { isTestFile } from "../../domain/analysis/entry-points.js";
import { Finding } from "../../domain/finding.js";
import { COMPLEXITY_LIMIT } from "../../domain/function-length.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import { principleOf } from "../../domain/principles.js";
import type { Repository } from "../../domain/repository.js";
import type { StructureSettings } from "../../domain/structure-settings.js";
import type { Say } from "../shared/ports/process.js";
import { decode } from "./measure-duplication.js";
import type { Parsers } from "./ports/parsing.js";
import type { SourceFiles } from "./ports/source-files.js";

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
): Finding {
  return Finding.stored({
    id: `complexity:${fn.identity}`,
    kind: "complexity",
    severity: "warning",
    ...principleOf("cyclomatic-complexity-limit"),
    summary: `${fn.qualified} has complexity ${fn.complexity}, over the limit of ${limit}`,
    files: [module],
    members: [
      {
        file: module,
        name: fn.qualified,
        sourceFile: module,
        lines: [fn.startLine, fn.endLine],
      },
    ],
    measures: {
      complexity: fn.complexity,
      limit,
      ...(limit === COMPLEXITY_LIMIT ? {} : { published: COMPLEXITY_LIMIT }),
    },
  });
}

export interface ComplexityMeasure {
  findings: Finding[];
  values: Record<string, number>;
}

export function measureComplexityValues(
  source: SourceFiles,
  say: Say,
  root: string,
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  settings: StructureSettings,
  parsers: Parsers,
): ComplexityMeasure {
  const limit = settings.complexity_limit;
  const findings: Finding[] = [];
  const values: Record<string, number> = {};

  const { ids } = repository.graphKeeping(policy);

  for (const module of repository.files) {
    const grammar = grammarFor(module.path);

    if (grammar === null || !ids.has(module.path) || isTestFile(module.path)) {
      continue;
    }

    let bytes: Uint8Array;

    try {
      bytes = source.readBytes(root, module.path);
    } catch {
      continue;
    }

    const text = decode(say, module.path, bytes, "complexity");

    if (text === null) {
      continue;
    }

    for (const fn of measureSource(module.path, text, grammar, parsers)) {
      const key = `${module.path}::${fn.qualified}`;

      values[key] = Math.max(values[key] ?? 0, fn.complexity);

      if (fn.complexity > limit) {
        findings.push(findingOf(module.path, fn, limit));
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
  source: SourceFiles,
  say: Say,
  root: string,
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  settings: StructureSettings,
  parsers: Parsers,
): Finding[] {
  return measureComplexityValues(
    source,
    say,
    root,
    repository,
    policy,
    settings,
    parsers,
  ).findings;
}
