import type { FindingsDocument } from "./adapters/filesystem/findings-document-types.js";
import validate from "./generated/findings-validator.js";

export interface ExpectedSensor {
  name?: string;
  commit?: string;
}

export function validateFindings(
  value: unknown,
  expected: ExpectedSensor = {},
): FindingsDocument {
  if (!validate(value)) {
    const first = validate.errors?.[0];

    throw new Error(
      first === undefined
        ? "findings are invalid"
        : `findings${first.instancePath} ${first.message ?? "is invalid"}`,
    );
  }

  const document = value as unknown as FindingsDocument;
  const seen = new Set<string>();

  for (const finding of document.findings) {
    if (seen.has(finding.id)) {
      throw new Error(`findings repeat the id ${finding.id}`);
    }

    seen.add(finding.id);
  }

  if (expected.name !== undefined && document.sensor.name !== expected.name) {
    throw new Error(
      `findings are from sensor ${document.sensor.name}, not ${expected.name}`,
    );
  }

  if (expected.commit !== undefined && document.commit !== expected.commit) {
    throw new Error(
      `findings commit ${document.commit} is not the repository's ${expected.commit}`,
    );
  }

  return document;
}
