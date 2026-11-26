import { machineSetting } from "./core-settings.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounds(key: string): { minimum: number; maximum: number } {
  const { minimum, maximum } = machineSetting(key);

  return { minimum: minimum as number, maximum: maximum as number };
}

function modelProblem(key: string, model: unknown): string | null {
  return typeof model !== "string" ||
    model === "" ||
    model.startsWith("-") ||
    /\s/.test(model)
    ? `${key}.model must be a non-empty name with no whitespace and no leading -`
    : null;
}

function isPresent(value: unknown): boolean {
  return value !== undefined;
}

export function describingProblem(value: unknown): string | null {
  if (!isRecord(value)) {
    return "describing must be an object";
  }

  const { model, batch_size: batchSize, confirm_above_usd: confirm } = value;
  const batch = bounds("describing.batch_size");
  const spend = bounds("describing.confirm_above_usd");

  return (
    (isPresent(model) ? modelProblem("describing", model) : null) ??
    (isPresent(batchSize) &&
    (typeof batchSize !== "number" ||
      !Number.isInteger(batchSize) ||
      batchSize < batch.minimum ||
      batchSize > batch.maximum)
      ? `describing.batch_size must be a whole number from ${batch.minimum} to ${batch.maximum}`
      : null) ??
    (isPresent(confirm) &&
    (typeof confirm !== "number" ||
      !Number.isFinite(confirm) ||
      confirm < spend.minimum ||
      confirm > spend.maximum)
      ? `describing.confirm_above_usd must be a number from ${spend.minimum} to ${spend.maximum}`
      : null)
  );
}

export function setupProblem(value: unknown): string | null {
  if (!isRecord(value)) {
    return "setup must be an object";
  }

  return isPresent(value.model) ? modelProblem("setup", value.model) : null;
}

export function appSettingsProblem(settings: {
  describing: unknown;
  setup: unknown;
}): string | null {
  return (
    (isPresent(settings.describing)
      ? describingProblem(settings.describing)
      : null) ??
    (isPresent(settings.setup) ? setupProblem(settings.setup) : null)
  );
}

export interface DescribingValues {
  model: string | null;
  batch_size: number;
  confirm_above_usd: number;
}

function storedOr<T>(stored: Record<string, unknown>, key: string): T {
  const field = key.split(".")[1] as string;

  return (
    isPresent(stored[field]) ? stored[field] : machineSetting(key).default
  ) as T;
}

export function describingValues(
  stored: Record<string, unknown>,
  published: { model: string | null },
): DescribingValues {
  return {
    model: isPresent(stored.model) ? (stored.model as string) : published.model,
    batch_size: storedOr<number>(stored, "describing.batch_size"),
    confirm_above_usd: storedOr<number>(stored, "describing.confirm_above_usd"),
  };
}

export function setupValues(stored: Record<string, unknown>): {
  model: string;
} {
  return { model: storedOr<string>(stored, "setup.model") };
}
