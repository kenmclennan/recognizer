import { join } from "node:path";
import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import schema from "./generated/config.schema.json" with { type: "json" };

export interface Config {
  describer?: { command: string[]; version: string };
}

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  compiled ??= new Ajv2020({ allErrors: true }).compile(schema);

  return compiled;
}

export function configFile(root: string): string {
  return join(root, ".recognizer", "config.yaml");
}

export function readConfig(io: Io, root: string): Config | null {
  const file = configFile(root);

  if (!io.exists(file)) {
    return null;
  }

  let document: unknown;

  try {
    document = parse(io.readFile(file)) ?? {};
  } catch (error) {
    throw new InputError([
      `config is not valid YAML: ${(error as Error).message}`,
    ]);
  }

  const validate = validator();

  if (validate(document)) {
    return document as Config;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `config${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["config is invalid"]);
}
