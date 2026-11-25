import { join } from "node:path";
import { describingProblem } from "@recognizer/core";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";

const CONFIG_DIR_ENV = "RECOGNIZER_APP_CONFIG_DIR";

export interface Describing {
  model: string;
  batch_size: number;
  confirm_above_usd: number;
}

export const DESCRIBING_DEFAULTS: Describing = {
  model: "haiku",
  batch_size: 4,
  confirm_above_usd: 5,
};

export function appConfigDir(io: Io): string {
  const override = io.env(CONFIG_DIR_ENV);

  if (override !== undefined && override !== "") {
    return override;
  }

  return join(
    io.env("HOME") ?? "",
    "Library",
    "Application Support",
    "com.kenmclennan.recognizer",
  );
}

function parseObject(text: string, file: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new InputError([
      `${file} is not valid JSON: ${(error as Error).message}`,
    ]);
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputError([`${file} must be a JSON object`]);
  }

  return value as Record<string, unknown>;
}

export function validateDescribing(value: unknown): Describing {
  const problem = describingProblem(value);

  if (problem !== null) {
    throw new InputError([problem.replace(/^(\S+)/, "$1 in config.json")]);
  }

  const {
    model,
    batch_size: batchSize,
    confirm_above_usd: confirmAbove = DESCRIBING_DEFAULTS.confirm_above_usd,
  } = value as Record<string, unknown>;

  return {
    model: model as string,
    batch_size: batchSize as number,
    confirm_above_usd: confirmAbove as number,
  };
}

export function readDescribing(io: Io): Describing {
  const file = join(appConfigDir(io), "config.json");
  const object = io.exists(file) ? parseObject(io.readFile(file), file) : {};

  if (object.describing !== undefined && object.describing !== null) {
    return validateDescribing(object.describing);
  }

  const seeded = { ...object, describing: { ...DESCRIBING_DEFAULTS } };
  const temp = `${file}.tmp`;

  try {
    io.writeFile(temp, `${JSON.stringify(seeded, null, 2)}\n`);
    io.rename(temp, file);
  } catch (error) {
    throw new InputError([
      `could not write the describing settings to ${file}: ${(error as Error).message}`,
    ]);
  }

  return { ...DESCRIBING_DEFAULTS };
}
