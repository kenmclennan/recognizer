export const REASON_PREFIX = "recognizer-reason ";

export const DIAGNOSIS_CODES = [
  "tool-missing",
  "tests-failed",
  "coverage-unavailable",
] as const;

export type DiagnosisCode = (typeof DIAGNOSIS_CODES)[number];

export interface Diagnosis {
  code: DiagnosisCode;
  line: string;
  suite?: string;
  fix?: string;
  failing?: { count?: number; names: string[] };
}

const MAX_NAMES = 5;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function onlyKeys(value: object, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function failingOk(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const { count, names } = value as Record<string, unknown>;

  return (
    onlyKeys(value, ["count", "names"]) &&
    (count === undefined ||
      (Number.isInteger(count) && (count as number) >= 1)) &&
    Array.isArray(names) &&
    names.length <= MAX_NAMES &&
    names.every(nonEmpty)
  );
}

export function isDiagnosis(value: unknown): value is Diagnosis {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const { code, line, suite, fix, failing } = value as Record<string, unknown>;

  return (
    onlyKeys(value, ["code", "line", "suite", "fix", "failing"]) &&
    DIAGNOSIS_CODES.includes(code as DiagnosisCode) &&
    nonEmpty(line) &&
    (suite === undefined || nonEmpty(suite)) &&
    (fix === undefined || nonEmpty(fix)) &&
    (failing === undefined || failingOk(failing))
  );
}

export function parseReasonLine(line: string): Diagnosis | null {
  if (!line.startsWith(REASON_PREFIX)) {
    return null;
  }

  let value: unknown;

  try {
    value = JSON.parse(line.slice(REASON_PREFIX.length));
  } catch {
    return null;
  }

  return isDiagnosis(value) ? value : null;
}

export function stripReason(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => parseReasonLine(line) === null)
    .join("\n");
}
