import { availableParallelism } from "node:os";

export const POOL_TIMEOUT_MULTIPLIER = 3;

export function poolScale(
  environment = process.env,
  cores = availableParallelism(),
) {
  const agents = Number(environment.LC_MAX_AGENTS);

  if (!Number.isFinite(agents) || agents <= 0) {
    return {
      maxWorkers: undefined,
      testTimeout: undefined,
      hookTimeout: undefined,
      multiplier: 1,
    };
  }

  return {
    maxWorkers: Math.max(1, Math.floor(cores / agents)),
    testTimeout: 5000 * POOL_TIMEOUT_MULTIPLIER,
    hookTimeout: 10000 * POOL_TIMEOUT_MULTIPLIER,
    multiplier: POOL_TIMEOUT_MULTIPLIER,
  };
}

export function scaledTimeout(milliseconds, environment = process.env) {
  return milliseconds * poolScale(environment).multiplier;
}

export function poolTestOptions(base = {}, environment = process.env) {
  const scale = poolScale(environment);
  const testTimeout =
    scale.multiplier === 1
      ? base.testTimeout
      : (base.testTimeout ?? 5000) * scale.multiplier;
  const hookTimeout =
    scale.multiplier === 1
      ? base.hookTimeout
      : (base.hookTimeout ?? 10000) * scale.multiplier;

  return {
    ...base,
    ...(scale.maxWorkers ? { maxWorkers: scale.maxWorkers } : {}),
    ...(testTimeout === undefined ? {} : { testTimeout }),
    ...(hookTimeout === undefined ? {} : { hookTimeout }),
  };
}
