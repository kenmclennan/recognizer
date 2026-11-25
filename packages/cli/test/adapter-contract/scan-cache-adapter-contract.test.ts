import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanCache } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { ScanCacheAdapter } from "../../src/adapters/filesystem/scan-cache-adapter.js";
import { FakeScanCache } from "../support/index.js";

function suite(
  title: string,
  make: (files: Record<string, string>) => { cache: ScanCache; root: string },
): void {
  describe(title, () => {
    it("a seeded folder reads back its scan files", () => {
      const { cache, root } = make({
        "scan.python.json": "{}",
        "scan.typescript.json": "[]",
      });

      expect(cache.read(root)).toEqual([
        { file: "scan.python.json", text: "{}" },
        { file: "scan.typescript.json", text: "[]" },
      ]);
    });

    it("a folder with no scans reads back nothing", () => {
      const { cache, root } = make({});

      expect(cache.read(root)).toEqual([]);
    });
  });
}

suite("Scan cache contract (fake)", (files) => {
  const cache = new FakeScanCache();

  cache.files.set(
    "/repo",
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, text]) => ({ file, text })),
  );

  return { cache, root: "/repo" };
});

suite("Scan cache contract (real adapter)", (files) => {
  const root = makeTempDir("scan-cache-contract-");
  const folder = join(root, ".recognizer", "cache");

  mkdirSync(folder, { recursive: true });

  for (const [file, text] of Object.entries(files)) {
    writeFileSync(join(folder, file), text);
  }

  return { cache: new ScanCacheAdapter(), root };
});
