import { grammarFor } from "../../../domain/analysis/duplication/grammars.js";
import type { Repository } from "../../../domain/repository.js";
import type { RunPhase } from "../../../domain/run-record.js";
import type { ScanSink } from "../../../domain/scan-sink.js";
import type { Parsers } from "../ports/parsing.js";
import { runStructureAnalysis } from "../run-structure-analysis.js";
import type { AnalysisPorts } from "./analysis-ports.js";

export interface RunAnalysisInput {
  root: string;
  repository: Repository;
  analysis: boolean;
  ignoreRetiredConfig: boolean;
  sink: ScanSink;
}

export interface AnalysisOutcome {
  ran: boolean;
  failed: boolean;
  ms: number | null;
  phase: RunPhase | null;
}

interface Measured {
  failed: boolean;
  ran: boolean;
  ms: number | null;
  reason?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function* analysisProcess(
  ports: AnalysisPorts,
  input: RunAnalysisInput,
): Generator<string[], Measured, Parsers | Error | null> {
  const {
    analysis,
    config,
    findings,
    policy: policies,
    clock,
    grammarRules: grammars,
  } = ports;
  const { root, repository, sink } = input;

  if (
    !config.readsSensorConfig() ||
    repository.extractions.length === 0 ||
    !input.analysis
  ) {
    return { failed: false, ran: false, ms: null };
  }

  let began: number | null = null;
  const timed = (failedRun: boolean, reason?: string): Measured => ({
    failed: failedRun,
    ran: true,
    ms: began === null ? null : clock.awake() - began,
    ...(reason === undefined ? {} : { reason }),
  });
  const fail = (reason: string): Measured => {
    sink.say("stderr", `failed ${analysis.name}: ${reason}\n`);

    return timed(true, reason);
  };

  try {
    const plan = analysis.analysisPlan(
      config.analysis(root, input.ignoreRetiredConfig),
    );

    findings.discardAnalysis(root, plan === "off");

    if (plan === "off") {
      return { failed: false, ran: false, ms: null };
    }

    sink.emit({ type: "analysis", state: "run" });

    began = clock.awake();

    const policy = policies.rules(root);
    analysis.reportPolicyProblems(root, repository, policy, sink.say);

    const rules = grammars.rules();
    const wanted =
      plan.duplication === false && !plan.warnings.complexity
        ? null
        : [
            ...new Set(
              repository.files.flatMap((file) => {
                const rule = grammarFor(file.path, rules);

                return rule === null ? [] : [rule.name];
              }),
            ),
          ];
    const label = plan.duplication === false ? "complexity" : "duplication";
    const answer = wanted === null ? null : yield wanted;
    const parsers = answer === null || answer instanceof Error ? null : answer;
    const run = runStructureAnalysis(ports, {
      say: sink.say,
      root,
      repository,
      policy,
      settings: plan,
      parsers,
      rules,
    });

    if (answer instanceof Error) {
      return fail(`${label}: ${answer.message}`);
    }

    if (run.error !== null) {
      return fail(run.error);
    }

    return timed(false);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export function finishAnalysis(
  ports: AnalysisPorts,
  input: RunAnalysisInput,
  measured: Measured,
): AnalysisOutcome {
  const { repository, sink } = input;

  if (!sink.stopped && measured.ran) {
    sink.emit({
      type: "analysis",
      state: measured.failed ? "failed" : "done",
      files: repository.extractions.reduce(
        (sum, extraction) => sum + extraction.files.length,
        0,
      ),
    });
  }

  return {
    ran: measured.ran,
    failed: measured.failed,
    ms: measured.ms,
    phase: measured.ran
      ? {
          phase: "analysis",
          entries: [
            {
              name: ports.analysis.name,
              command: [],
              status: null,
              outcome: measured.failed ? "failed" : "ok",
              duration_ms: measured.ms ?? 0,
              ...(measured.reason === undefined
                ? {}
                : { reason: measured.reason }),
              stderr: "",
            },
          ],
          duration_ms: measured.ms ?? 0,
        }
      : null,
  };
}
