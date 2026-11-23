import type { DocumentValidators, PluginFacts } from "@recognizer/core";
import { validateFindings } from "../../findings-document.js";
import validateCheck from "../../generated/check-validator.js";
import validateEvent from "../../generated/events-validator.js";
import findingsSchema from "../../generated/findings.schema.json" with {
  type: "json",
};
import validateManifest from "../../generated/manifest-validator.js";
import protocol from "../../generated/protocol.json" with { type: "json" };
import {
  SCAN_BREAKING_VERSIONS,
  SCAN_SCHEMA_VERSION,
  validateScan,
} from "../../scan.js";

type Validator = {
  (value: unknown): boolean;
  errors?: { instancePath: string; message?: string }[] | null;
};

function first(validate: Validator, fallback: string): string {
  const error = validate.errors?.[0];

  return error === undefined
    ? fallback
    : `${error.instancePath === "" ? "" : `${error.instancePath} `}${error.message ?? "is invalid"}`;
}

export class DocumentValidatorsAdapter implements DocumentValidators {
  readonly facts: PluginFacts = {
    protocol: protocol.protocol,
    scanSchemaVersion: SCAN_SCHEMA_VERSION,
    scanBreakingVersions: SCAN_BREAKING_VERSIONS,
    findingsVersion: Math.max(
      ...findingsSchema.properties.findings_version.enum,
    ),
  };

  manifest(value: unknown): string | null {
    if (validateManifest(value)) {
      return null;
    }

    const error = validateManifest.errors?.[0];

    return error === undefined
      ? "the manifest is invalid"
      : `${error.instancePath === "" ? "the manifest" : error.instancePath} ${error.message ?? "is invalid"}`;
  }

  scan(value: unknown): string | null {
    try {
      validateScan(value);

      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  findings(value: unknown, expected: { name?: string } = {}): string | null {
    try {
      validateFindings(value, expected);

      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  check(value: unknown): string | null {
    return validateCheck(value)
      ? null
      : first(validateCheck as Validator, "is invalid");
  }

  event(value: unknown): boolean {
    return validateEvent(value);
  }
}
