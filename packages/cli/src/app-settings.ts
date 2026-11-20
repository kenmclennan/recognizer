import { join } from "node:path";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";

const CONFIG_DIR_ENV = "RECOGNIZER_APP_CONFIG_DIR";
const MAX_BATCH_SIZE = 16;
const MAX_CONFIRM_ABOVE_USD = 10000;

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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputError(["describing in config.json must be an object"]);
  }

  const {
    model,
    batch_size: batchSize,
    confirm_above_usd: confirmAbove = DESCRIBING_DEFAULTS.confirm_above_usd,
  } = value as Record<string, unknown>;

  if (
    typeof model !== "string" ||
    model === "" ||
    model.startsWith("-") ||
    /\s/.test(model)
  ) {
    throw new InputError([
      "describing.model in config.json must be a non-empty name with no whitespace and no leading -",
    ]);
  }

  if (
    typeof batchSize !== "number" ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new InputError([
      `describing.batch_size in config.json must be a whole number from 1 to ${MAX_BATCH_SIZE}`,
    ]);
  }

  if (
    typeof confirmAbove !== "number" ||
    !Number.isFinite(confirmAbove) ||
    confirmAbove < 0 ||
    confirmAbove > MAX_CONFIRM_ABOVE_USD
  ) {
    throw new InputError([
      `describing.confirm_above_usd in config.json must be a number from 0 to ${MAX_CONFIRM_ABOVE_USD}`,
    ]);
  }

  return { model, batch_size: batchSize, confirm_above_usd: confirmAbove };
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
