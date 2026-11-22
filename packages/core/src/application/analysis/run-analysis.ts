import type { AnalysisPorts } from "./internal/analysis-ports.js";
import {
  type AnalysisOutcome,
  analysisProcess,
  finishAnalysis,
  type RunAnalysisInput,
} from "./internal/analysis-process.js";
import type { ParserSet } from "./ports/analysis.js";

export type { AnalysisOutcome, RunAnalysisInput };

export async function runAnalysis(
  ports: AnalysisPorts,
  input: RunAnalysisInput,
): Promise<AnalysisOutcome> {
  const process = analysisProcess(ports, input);
  let step = process.next();

  while (!step.done) {
    let answer: ParserSet | Error;

    try {
      answer = await ports.analysis.loadParsers(step.value);
    } catch (error) {
      answer = error as Error;
    }

    step = process.next(answer);
  }

  return finishAnalysis(ports, input, step.value);
}
