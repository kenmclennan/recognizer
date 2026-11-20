import type { AnalysisPorts } from "./internal/analysis-ports.js";
import {
  type AnalyseStructureInput,
  finishStructure,
  type StructureOutcome,
  structureProcess,
} from "./internal/structure-process.js";

export function analyseStructureSync(
  ports: AnalysisPorts,
  input: AnalyseStructureInput,
): StructureOutcome {
  const process = structureProcess(ports, input);
  let step = process.next();

  while (!step.done) {
    step = process.next(null);
  }

  return finishStructure(input, step.value);
}
