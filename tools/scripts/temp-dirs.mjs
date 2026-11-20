import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created = [];

export function makeTempDir(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  created.push(directory);

  return directory;
}

export function removeTempDirs() {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10 });
  }
}
