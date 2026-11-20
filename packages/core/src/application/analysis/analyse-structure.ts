import type { AnalysisPorts } from "./internal/analysis-ports.js";
import {
  type AnalyseStructureInput,
  finishStructure,
  type StructureOutcome,
  structureProcess,
} from "./internal/structure-process.js";
import type { ParserSet } from "./ports/analysis.js";

export type { AnalyseStructureInput, StructureOutcome };

export async function analyseStructure(
  ports: AnalysisPorts,
  input: AnalyseStructureInput,
): Promise<StructureOutcome> {
  const process = structureProcess(ports, input);
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

  return finishStructure(input, step.value);
}
