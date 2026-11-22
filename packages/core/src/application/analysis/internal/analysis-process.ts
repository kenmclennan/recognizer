import type { RunPhase } from "../../../domain/run-record.js";
import type { ScanDocument } from "../../../domain/scan-document.js";
import type { ScanSink } from "../../../domain/scan-sink.js";
import type { ParserSet } from "../ports/analysis.js";
import type { AnalysisPorts } from "./analysis-ports.js";

export interface RunAnalysisInput {
  root: string;
  scans: ScanDocument[];
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
): Generator<string[], Measured, ParserSet | Error | null> {
  const { analysis, store, clock } = ports;
  const { root, scans, sink } = input;

  if (!store.readsSensorConfig() || scans.length === 0 || !input.analysis) {
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
      store.analysisConfig(root, input.ignoreRetiredConfig),
    );

    store.removeAnalysisOutputs(root, plan === "off");

    if (plan === "off") {
      return { failed: false, ran: false, ms: null };
    }

    sink.emit({ type: "analysis", state: "run" });

    began = clock.awake();

    const policy = store.policy(root);
    const prepared = analysis.analysisPrepare(
      plan,
      root,
      scans,
      policy,
      sink.say,
    );
    const answer =
      prepared.parserLanguages === null ? null : yield prepared.parserLanguages;
    const parsers = answer === null || answer instanceof Error ? null : answer;
    const run = analysis.analysisRun(
      plan,
      root,
      scans,
      policy,
      parsers,
      sink.say,
    );

    if (answer instanceof Error) {
      return fail(`${prepared.label}: ${answer.message}`);
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
  const { scans, sink } = input;

  if (!sink.stopped && measured.ran) {
    sink.emit({
      type: "analysis",
      state: measured.failed ? "failed" : "done",
      files: scans.reduce((sum, scan) => sum + scan.files.length, 0),
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
