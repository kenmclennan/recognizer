import type { AnalysisPorts } from "./internal/analysis-ports.js";
import {
  type AnalysisOutcome,
  analysisProcess,
  finishAnalysis,
  type RunAnalysisInput,
} from "./internal/analysis-process.js";

export function runAnalysisSync(
  ports: AnalysisPorts,
  input: RunAnalysisInput,
): AnalysisOutcome {
  const process = analysisProcess(ports, input);
  let step = process.next();

  while (!step.done) {
    step = process.next(null);
  }

  return finishAnalysis(ports, input, step.value);
}
