import {
  type ExtractOutcome,
  type ExtractScansInput,
  extractProcess,
} from "./internal/extract-process.js";
import type { SyncScanningPorts } from "./internal/scanning-ports.js";

export function extractScansSync(
  ports: SyncScanningPorts,
  input: ExtractScansInput,
): ExtractOutcome {
  const process = extractProcess(ports, input);
  let step = process.next();

  while (!step.done) {
    step = process.next(ports.scanners.extract(step.value));
  }

  return step.value;
}
