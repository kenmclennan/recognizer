import type { DocumentValidators, PluginFacts } from "../../src/index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class FakeDocumentValidators implements DocumentValidators {
  facts: PluginFacts = {
    protocol: 2,
    scanSchemaVersion: 7,
    scanBreakingVersions: [5],
    findingsVersion: 1,
  };

  manifest(value: unknown): string | null {
    return isRecord(value) &&
      typeof value.kind === "string" &&
      typeof value.name === "string" &&
      typeof value.protocol === "number"
      ? null
      : "the manifest is invalid";
  }

  scan(value: unknown): string | null {
    return isRecord(value) && typeof value.schema_version === "number"
      ? null
      : "scan is invalid";
  }

  findings(value: unknown): string | null {
    return isRecord(value) && Array.isArray(value.findings)
      ? null
      : "findings are invalid";
  }

  check(value: unknown): string | null {
    return isRecord(value) && typeof value.ready === "boolean"
      ? null
      : "is invalid";
  }

  event(value: unknown): boolean {
    return isRecord(value) && typeof value.event === "string";
  }
}
