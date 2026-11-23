import {
  type CheckResult,
  checkViolations,
  type Identity,
  type PolicyRule,
} from "@recognizer/core";
import { readScanFile } from "./adapters/filesystem/scan-translator.js";

export function check(
  scan: unknown,
  policy: readonly PolicyRule[],
  baseline: Identity[] | null,
): CheckResult {
  return checkViolations(readScanFile(scan), policy, baseline);
}
