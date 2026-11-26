import { join } from "node:path";
import {
  describingProblem,
  describingValues,
  type Prices,
  publishedModel,
  readManifestOf,
  splitAtRun,
} from "@recognizer/core";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { manifestPorts } from "./manifest-ports.js";

const CONFIG_DIR_ENV = "RECOGNIZER_APP_CONFIG_DIR";

export interface DescribingRead {
  model: string;
  batch_size: number;
  confirm_above_usd: number;
  prices: Prices | undefined;
}

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

function readStored(io: Io): Record<string, unknown> {
  const file = join(appConfigDir(io), "config.json");
  const object = io.exists(file) ? parseObject(io.readFile(file), file) : {};
  const stored = object.describing;

  if (stored === undefined || stored === null) {
    return {};
  }

  const problem = describingProblem(stored);

  if (problem !== null) {
    throw new InputError([problem.replace(/^(\S+)/, "$1 in config.json")]);
  }

  return stored as Record<string, unknown>;
}

export function readDescribing(
  io: Io,
  describer: { command: readonly string[] },
  root: string,
): DescribingRead {
  const stored = readStored(io);
  const split = splitAtRun(describer.command);
  const manifest =
    split === null || split.prefix.length === 0
      ? null
      : readManifestOf(
          manifestPorts(io),
          split.prefix.map((item) => item.split("{repository}").join(root)),
        );

  if (manifest !== null && !manifest.ok) {
    throw new InputError([manifest.reason]);
  }

  const settings = manifest === null ? [] : manifest.manifest.settings;
  const values = describingValues(stored, {
    model: publishedModel(settings),
  });

  if (values.model === null) {
    throw new InputError([
      "describing.model is not set in config.json and the describer publishes no default",
    ]);
  }

  return { ...values, model: values.model, prices: manifest?.manifest.prices };
}
