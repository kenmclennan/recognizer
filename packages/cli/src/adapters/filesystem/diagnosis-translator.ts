import type { Diagnosis } from "@recognizer/core";
import type { DocumentDiagnosis } from "./findings-document-types.js";

export function diagnosisOf(document: DocumentDiagnosis): Diagnosis {
  const { failing, ...rest } = document;

  return {
    ...rest,
    ...(failing === undefined
      ? {}
      : {
          failing: {
            names: [...failing.names],
            ...(failing.count === undefined ? {} : { count: failing.count }),
          },
        }),
  };
}

export function diagnosisDocumentOf(diagnosis: Diagnosis): DocumentDiagnosis {
  const { failing, ...rest } = diagnosis;

  return {
    ...rest,
    ...(failing === undefined
      ? {}
      : { failing: { ...failing, names: [...failing.names] } }),
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function failingOf(value: unknown): Diagnosis["failing"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { count, names } = value as Record<string, unknown>;

  if (!Array.isArray(names) || !names.every(nonEmpty)) {
    return null;
  }

  return {
    names,
    ...(typeof count === "number" && Number.isInteger(count) && count >= 1
      ? { count }
      : {}),
  };
}

export function readDiagnosis(value: unknown): Diagnosis | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { code, line, fix, failing, unmeasured, suite } = value as Record<
    string,
    unknown
  >;

  if (
    !nonEmpty(code) ||
    !nonEmpty(line) ||
    (fix !== undefined && !nonEmpty(fix)) ||
    (suite !== undefined && !nonEmpty(suite)) ||
    (unmeasured !== undefined && typeof unmeasured !== "boolean")
  ) {
    return null;
  }

  const names = failing === undefined ? undefined : failingOf(failing);

  if (names === null) {
    return null;
  }

  return {
    code,
    line,
    ...(suite === undefined ? {} : { suite }),
    ...(fix === undefined ? {} : { fix }),
    ...(unmeasured === undefined ? {} : { unmeasured }),
    ...(names === undefined ? {} : { failing: names }),
  };
}
