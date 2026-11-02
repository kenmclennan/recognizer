import validate from "./generated/log-validator.js";
import type { RunRecord } from "./run-log.js";

export function validateRunRecord(value: unknown): RunRecord {
  if (!validate(value)) {
    const first = validate.errors?.[0];

    throw new Error(
      first === undefined
        ? "run record is invalid"
        : `run record${first.instancePath} ${first.message ?? "is invalid"}`,
    );
  }

  return value as unknown as RunRecord;
}
