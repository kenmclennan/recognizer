export const POOL_TIMEOUT_MULTIPLIER: number;
export function poolScale(
  environment?: Record<string, string | undefined>,
  cores?: number,
): {
  maxWorkers: number | undefined;
  allWorkers: number | undefined;
  halfWorkers: number | undefined;
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
  workers?: "shared" | "all" | "half",
): T & { maxWorkers?: number; testTimeout?: number; hookTimeout?: number };
