import { existsSync } from "node:fs";
import { join } from "node:path";

export const REQUIRED_BUILDS = [
  "packages/core/dist/src/index.js",
  "packages/cli/dist/bin.js",
  "packages/scanners/typescript/dist/bin.js",
  "packages/describers/claude/dist/bin.js",
];

export function missingBuilds(root, exists = existsSync) {
  return REQUIRED_BUILDS.filter((path) => !exists(join(root, path)));
}

export async function ensureBuilt(root, build) {
  const missing = missingBuilds(root);

  if (missing.length > 0) {
    await build();
  }

  return missing;
}
