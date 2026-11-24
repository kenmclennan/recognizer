import { carryMeasured } from "../../domain/analysis/duplication/carry.js";
import type { DuplicationSettings } from "../../domain/analysis/duplication/findings.js";
import type { GrammarRule } from "../../domain/analysis/duplication/grammars.js";
import { LanguageBehaviour } from "../../domain/analysis/language-behaviour.js";
import { scansCommit } from "../../domain/analysis/scans-commit.js";
import type { FindingsRepository } from "../../domain/findings-repository.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import type { StructureSettings } from "../../domain/structure-settings.js";
import type { Warning } from "../../domain/warning.js";
import type { Say } from "../shared/ports/process.js";
import { functionLengths } from "./long-function-findings.js";
import { measureComplexityValues } from "./measure-complexity.js";
import {
  type MeasurePorts,
  measureDuplication,
} from "./measure-duplication.js";
import type { Digest } from "./ports/digest.js";
import type { Parsers } from "./ports/parsing.js";
import type { PublishedLanguages } from "./ports/published-languages.js";
import type { SourceFiles } from "./ports/source-files.js";
import { type StructureResult, senseStructure } from "./sense-structure.js";

export interface StructureAnalysisPorts {
  findings: FindingsRepository;
  source: SourceFiles;
  digest: Digest;
  languages: PublishedLanguages;
}

export interface StructureAnalysisInput {
  say: Say;
  root: string;
  repository: Repository;
  policy: readonly PolicyRule[] | null;
  settings: StructureSettings;
  parsers: Parsers | null;
  rules: readonly GrammarRule[];
}

export interface StructureRun {
  sensed: StructureResult;
  commit: string | null;
  error: string | null;
}

export function runStructureAnalysis(
  ports: StructureAnalysisPorts,
  input: StructureAnalysisInput,
): StructureRun {
  const { say, root, repository, policy, settings, parsers, rules } = input;
  const measuring: MeasurePorts = ports;
  const behaviour = new LanguageBehaviour(ports.languages.rules());
  const { commit, modified } = scansCommit(repository);
  const context = { commit: commit ?? "", modified };
  const errors: string[] = [];
  let sensed: StructureResult;
  let complexityValues: Record<string, number> | null = null;
  let duplicationWarnings: Warning[] | null = null;

  if (parsers !== null) {
    const attempt = (
      label: string,
      wanted: boolean,
      measure: (loaded: Parsers) => Warning[],
    ): Warning[] | null => {
      if (!wanted) {
        return null;
      }

      try {
        return measure(parsers);
      } catch (error) {
        errors.push(`${label}: ${(error as Error).message}`);

        return null;
      }
    };

    duplicationWarnings = attempt(
      "duplication",
      settings.duplication !== false,
      (loaded) =>
        measureDuplication(
          measuring,
          say,
          root,
          repository,
          settings.duplication as DuplicationSettings,
          loaded,
          rules,
          true,
        ),
    );

    const complexity = attempt(
      "complexity",
      settings.warnings.complexity,
      (loaded) => {
        const measured = measureComplexityValues(
          ports.source,
          say,
          root,
          repository,
          policy,
          settings,
          loaded,
          rules,
          behaviour,
        );

        complexityValues = measured.values;

        return measured.warnings;
      },
    );

    sensed = senseStructure(repository, policy, settings, context, behaviour, {
      duplication: duplicationWarnings,
      complexity,
    });
  } else {
    const plain = senseStructure(
      repository,
      policy,
      settings,
      context,
      behaviour,
    );

    sensed = {
      ...plain,
      document: carryMeasured(
        ports.findings.readStructure(root),
        plain.document,
        settings,
      ),
    };
  }

  const measureError = errors.length > 0 ? errors.join("; ") : null;

  if (commit === null) {
    return { sensed, commit, error: measureError };
  }

  try {
    ports.findings.save(root, sensed.document);

    if (parsers !== null) {
      ports.findings.saveStructureOverlay(root, {
        commit,
        modified,
        repository,
        complexity: complexityValues,
        functionLength: functionLengths(repository, policy, behaviour),
        duplication:
          duplicationWarnings?.map((warning) => warning.toFinding()) ?? null,
      });
    }

    return { sensed, commit, error: measureError };
  } catch (error) {
    return { sensed, commit, error: (error as Error).message };
  }
}
