import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanCache, ScanFileText } from "@recognizer/core";

const CACHE = join(".recognizer", "cache");
const SCAN_FILE = /^scan\.[^/]+\.json$/;

export class ScanCacheAdapter implements ScanCache {
  read(root: string): readonly ScanFileText[] {
    let names: string[];

    try {
      names = readdirSync(join(root, CACHE));
    } catch {
      return [];
    }

    const files: ScanFileText[] = [];

    for (const file of names.filter((name) => SCAN_FILE.test(name)).sort()) {
      const path = join(root, CACHE, file);

      try {
        if (lstatSync(path).isFile()) {
          files.push({ file, text: readFileSync(path, "utf8") });
        }
      } catch {}
    }

    return files;
  }
}
