export const REQUIRED_BUILDS: string[];
export function missingBuilds(
  root: string,
  exists?: (path: string) => boolean,
): string[];
export function ensureBuilt(
  root: string,
  build: () => void | Promise<void>,
): Promise<string[]>;
