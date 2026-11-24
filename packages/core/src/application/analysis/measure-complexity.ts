import { cyclomaticComplexity } from "../../domain/analysis/complexity/count.js";
import { findFunctions } from "../../domain/analysis/duplication/functions.js";
import {
  type GrammarRule,
  grammarFor,
} from "../../domain/analysis/duplication/grammars.js";
import { assignIdentities } from "../../domain/analysis/duplication/identity.js";
import { isTestFile } from "../../domain/analysis/entry-points.js";
import { COMPLEXITY_LIMIT } from "../../domain/function-length.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import type { StructureSettings } from "../../domain/structure-settings.js";
import { Warning } from "../../domain/warning.js";
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
  rule: GrammarRule,
  parsers: Parsers,
): MeasuredFunction[] {
  const parser = parsers.get(rule.name);

  if (parser === undefined) {
    throw new Error(`no ${rule.name} parser is loaded for ${module}`);
  }

  const tree = parser.parse(source);

  if (tree === null) {
    return [];
  }

  try {
    const found = findFunctions(tree.rootNode, rule).filter(
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
        complexity: cyclomaticComplexity(one.node, rule, excluded),
      };
    });
  } finally {
    tree.delete();
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function warningOf(
  module: string,
  fn: MeasuredFunction,
  limit: number,
): Warning {
  return new Warning({
    id: `complexity:${fn.identity}`,
    kind: "complexity",
    principle: "cyclomatic-complexity-limit",
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
  warnings: Warning[];
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
  rules: readonly GrammarRule[],
): ComplexityMeasure {
  const limit = settings.complexity_limit;
  const warnings: Warning[] = [];
  const values: Record<string, number> = {};

  const { ids } = repository.graphKeeping(policy);

  for (const module of repository.files) {
    const rule = grammarFor(module.path, rules);

    if (rule === null || !ids.has(module.path) || isTestFile(module.path)) {
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

    for (const fn of measureSource(module.path, text, rule, parsers)) {
      const key = `${module.path}::${fn.qualified}`;

      values[key] = Math.max(values[key] ?? 0, fn.complexity);

      if (fn.complexity > limit) {
        warnings.push(warningOf(module.path, fn, limit));
      }
    }
  }

  const seen = new Set<string>();

  return {
    warnings: warnings
      .filter((warning) => !seen.has(warning.id) && seen.add(warning.id))
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
  rules: readonly GrammarRule[],
): Warning[] {
  return measureComplexityValues(
    source,
    say,
    root,
    repository,
    policy,
    settings,
    parsers,
    rules,
  ).warnings;
}
