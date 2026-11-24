import type { Responsibility } from "@recognizer/core";
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

export function toResponsibility(entry: ResponsibilityEntry): Responsibility {
  return {
    line: entry.line,
    sourceHash: entry.source_hash,
    describer: entry.describer,
    version: entry.version,
  };
}
