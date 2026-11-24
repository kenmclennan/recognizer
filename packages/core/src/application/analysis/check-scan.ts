import { LanguageBehaviour } from "../../domain/analysis/language-behaviour.js";
import {
  COMPLEXITY_LIMIT,
  LONG_FUNCTION,
} from "../../domain/function-length.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import type { StructureSettings } from "../../domain/structure-settings.js";
import {
  type BaselineFlags,
  type BaselineRepository,
  settleBaseline,
} from "../history/settle-baseline.js";
import type { Say } from "../shared/ports/process.js";
import { candidatesOf, warningsOf } from "./check-findings.js";
import {
  type CheckReport,
  refuseBadBaselineFlags,
} from "./check-repository.js";
import type { Analysis } from "./ports/analysis.js";
import type { PublishedLanguages } from "./ports/published-languages.js";
import { senseStructure } from "./sense-structure.js";

export interface CheckScanPorts {
  analysis: Analysis;
  baselines: BaselineRepository;
  languages: PublishedLanguages;
}

export interface CheckScanInput {
  repository: Repository;
  rules: readonly PolicyRule[] | null;
  policyFile: string | null;
  baselinePath: string | null;
  flags: BaselineFlags;
}

const REPLAY_SETTINGS: StructureSettings = {
  duplication: false,
  entry_points: [],
  entry_annotations: [],
  warnings: {
    cycle: true,
    orphan: true,
    unused_exports: false,
    private_imports: true,
    long_function: true,
    complexity: true,
  },
  long_function_limit: LONG_FUNCTION,
  complexity_limit: COMPLEXITY_LIMIT,
};

export function refuseBadScanFlags(
  flags: BaselineFlags,
  policyGiven: boolean,
): void {
  refuseBadBaselineFlags(flags, policyGiven);
}

export function checkScan(
  ports: CheckScanPorts,
  say: Say,
  input: CheckScanInput,
): CheckReport {
  const { repository, rules, policyFile, flags } = input;

  if (rules !== null && policyFile !== null) {
    ports.analysis.reportPolicyProblems("", repository, rules, say, policyFile);
  }

  const sensed = senseStructure(
    repository,
    rules,
    REPLAY_SETTINGS,
    { commit: "", modified: false },
    new LanguageBehaviour(ports.languages.rules()),
  );
  const warnings = warningsOf([sensed.document]);
  const shared = {
    warnings,
    metrics: sensed.metrics,
    folderMetrics: sensed.folder_metrics,
    sensors: [],
  };

  if (rules === null) {
    return { ranked: null, baseline: null, ...shared, exit: 0 };
  }

  if (input.baselinePath === null) {
    throw new InvalidRequest(["a policy needs a baseline path"]);
  }

  const { result, report } = settleBaseline(
    ports.baselines,
    flags,
    input.baselinePath,
    candidatesOf([sensed.document]),
  );

  return {
    ranked: result,
    baseline: report,
    ...shared,
    exit: result.new.length > 0 ? 1 : 0,
  };
}
