import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { InputError } from "./errors.js";
import schema from "./generated/responsibilities.schema.json" with {
  type: "json",
};

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

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  compiled ??= new Ajv2020({ allErrors: true }).compile(schema);

  return compiled;
}

export function validateResponsibilities(value: unknown): Responsibilities {
  const validate = validator();

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
