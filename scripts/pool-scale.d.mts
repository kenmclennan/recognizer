export const POOL_TIMEOUT_MULTIPLIER: number;
export function poolScale(
  environment?: Record<string, string | undefined>,
  cores?: number,
): {
  maxWorkers: number | undefined;
  testTimeout: number | undefined;
  hookTimeout: number | undefined;
  multiplier: number;
};
export function scaledTimeout(
  milliseconds: number,
  environment?: Record<string, string | undefined>,
): number;
export function poolTestOptions<T extends Record<string, unknown>>(
  base?: T,
  environment?: Record<string, string | undefined>,
): T & { maxWorkers?: number; testTimeout?: number; hookTimeout?: number };
