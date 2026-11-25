export const MAX_BATCH_SIZE = 16;
export const MAX_CONFIRM_ABOVE_USD = 10000;
export const DEFAULT_CONFIRM_ABOVE_USD = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelProblem(key: string, model: unknown): string | null {
  return typeof model !== "string" ||
    model === "" ||
    model.startsWith("-") ||
    /\s/.test(model)
    ? `${key}.model must be a non-empty name with no whitespace and no leading -`
    : null;
}

export function describingProblem(value: unknown): string | null {
  if (!isRecord(value)) {
    return "describing must be an object";
  }

  const { model, batch_size: batchSize } = value;
  const confirmAbove =
    value.confirm_above_usd === undefined
      ? DEFAULT_CONFIRM_ABOVE_USD
      : value.confirm_above_usd;

  return (
    modelProblem("describing", model) ??
    (typeof batchSize !== "number" ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
      ? `describing.batch_size must be a whole number from 1 to ${MAX_BATCH_SIZE}`
      : null) ??
    (typeof confirmAbove !== "number" ||
    !Number.isFinite(confirmAbove) ||
    confirmAbove < 0 ||
    confirmAbove > MAX_CONFIRM_ABOVE_USD
      ? `describing.confirm_above_usd must be a number from 0 to ${MAX_CONFIRM_ABOVE_USD}`
      : null)
  );
}

export function setupProblem(value: unknown): string | null {
  if (!isRecord(value)) {
    return "setup must be an object";
  }

  return modelProblem("setup", value.model);
}

export function appSettingsProblem(settings: {
  describing: unknown;
  setup: unknown;
}): string | null {
  return describingProblem(settings.describing) ?? setupProblem(settings.setup);
}
