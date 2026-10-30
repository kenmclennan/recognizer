import { InputError } from "./errors.js";
import validate from "./generated/responsibilities-validator.js";

export interface ResponsibilityEntry {
  line: string;
  source_hash: string;
  describer: string[];
  version: string;
}

export interface Responsibilities {
  schema_version: 1;
  modules: Record<string, ResponsibilityEntry>;
}

export type LineStatus =
  | { status: "missing" }
  | { status: "current" }
  | { status: "out-of-date"; reasons: ("source" | "describer" | "version")[] };

export function validateResponsibilities(value: unknown): Responsibilities {
  if (validate(value)) {
    return value as unknown as Responsibilities;
  }

  const messages = (validate.errors ?? []).map(
    (error) =>
      `responsibilities${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(
    messages.length > 0 ? messages : ["responsibilities is invalid"],
  );
}

export function lineStatus(
  entry: ResponsibilityEntry | undefined,
  sourceHash: string,
  describer: string[],
  version: string,
): LineStatus {
  if (entry === undefined) {
    return { status: "missing" };
  }

  const reasons: ("source" | "describer" | "version")[] = [];

  if (entry.source_hash !== sourceHash) {
    reasons.push("source");
  }

  if (JSON.stringify(entry.describer) !== JSON.stringify(describer)) {
    reasons.push("describer");
  }

  if (entry.version !== version) {
    reasons.push("version");
  }

  return reasons.length === 0
    ? { status: "current" }
    : { status: "out-of-date", reasons };
}
