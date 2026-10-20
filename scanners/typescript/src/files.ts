import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "test",
  "tests",
  "__tests__",
]);

export function isSkippedDirectory(name: string): boolean {
  return SKIPPED_DIRECTORIES.has(name) || name.startsWith(".");
}

export function isSourceFile(name: string): boolean {
  if (!SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return false;
  }

  if (name.endsWith(".d.ts")) {
    return false;
  }

  return !/\.(test|spec)\./.test(name);
}

export function listSourceFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) {
          walk(path);
        }
      } else if (entry.isFile() || isFileSymlink(entry, path)) {
        if (isSourceFile(entry.name)) {
          found.push(path);
        }
      }
    }
  };

  walk(root);

  return found;
}

function isFileSymlink(
  entry: { isSymbolicLink(): boolean },
  path: string,
): boolean {
  if (!entry.isSymbolicLink()) {
    return false;
  }

  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
