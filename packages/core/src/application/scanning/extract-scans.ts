import {
  type ExtractOutcome,
  type ExtractScansInput,
  extractProcess,
} from "./internal/extract-process.js";
import type { ScanningPorts } from "./internal/scanning-ports.js";

export type { ExtractOutcome, ExtractScansInput };

export async function extractScans(
  ports: ScanningPorts,
  input: ExtractScansInput,
): Promise<ExtractOutcome> {
  const process = extractProcess(ports, input);
  let step = process.next();

  while (!step.done) {
    step = process.next(await ports.scanners.extract(step.value));
  }

  return step.value;
}
