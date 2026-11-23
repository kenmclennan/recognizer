import {
  judgeScanVersion as judgeVersion,
  type ScanVersionVerdict,
} from "@recognizer/core";
import type { ScanDoc } from "./adapters/filesystem/scan-document-types.js";
import { InputError } from "./errors.js";
import schema from "./generated/scan.schema.json" with { type: "json" };
import breaking from "./generated/scan-breaking-versions.json" with {
  type: "json",
};
import validate from "./generated/scan-validator.js";

export const SCAN_SCHEMA_VERSION: number =
  schema.properties.schema_version.const;

export const SCAN_BREAKING_VERSIONS: number[] = breaking;

export type { ScanVersionVerdict } from "@recognizer/core";

export function judgeScanVersion(
  found: number,
  current: number = SCAN_SCHEMA_VERSION,
  breaks: readonly number[] = SCAN_BREAKING_VERSIONS,
): ScanVersionVerdict {
  return judgeVersion(found, current, breaks);
}

export function validateScan(value: unknown): ScanDoc {
  if (validate(value)) {
    return value as unknown as ScanDoc;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `scan${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["scan is invalid"]);
}

export function validateAcceptedScan(
  value: unknown,
  current: number = SCAN_SCHEMA_VERSION,
  breaks: readonly number[] = SCAN_BREAKING_VERSIONS,
): ScanDoc {
  const version = (value as { schema_version?: unknown } | null)
    ?.schema_version;

  if (typeof version !== "number" || !Number.isInteger(version)) {
    return validateScan(value);
  }

  const verdict = judgeScanVersion(version, current, breaks);

  if (verdict === "newer" || verdict === "broken") {
    throw new InputError([
      `scan has schema_version ${version}, recognizer accepts ${current}`,
    ]);
  }

  if (verdict === "current") {
    return validateScan(value);
  }

  validateScan({ ...(value as object), schema_version: SCAN_SCHEMA_VERSION });

  return value as unknown as ScanDoc;
}
