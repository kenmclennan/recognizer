import { mkdirSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

const MARKER = `${sep}.recognizer${sep}cache`;

export function cacheFolderOf(path: string): string | null {
  const index = path.indexOf(`${MARKER}${sep}`);

  if (index === -1) {
    return null;
  }

  return path.slice(0, index + MARKER.length);
}

export function ensureCacheIgnore(path: string): void {
  const folder = cacheFolderOf(path);

  if (folder === null) {
    return;
  }

  mkdirSync(folder, { recursive: true });

  try {
    writeFileSync(join(folder, ".gitignore"), "*\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}
