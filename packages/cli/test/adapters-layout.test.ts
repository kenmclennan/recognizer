import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const adapters = resolve(here, "../src/adapters");

const expected: Record<string, string[]> = {
  filesystem: [
    "scan-document-types.ts",
    "scan-translator.ts",
    "store-adapter.ts",
  ],
  git: ["git-adapter.ts"],
  plugins: [
    "describer-adapter.ts",
    "process-adapter.ts",
    "scanners-adapter.ts",
    "sensors-adapter.ts",
    "sink-io.ts",
  ],
  system: ["clock-adapter.ts"],
  terminal: ["confirm-adapter.ts"],
};

describe("adapters layout", () => {
  it("adapters sit in the folder for their infrastructure", () => {
    const entries = readdirSync(adapters, { withFileTypes: true });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((entry) => !entry.isDirectory())).toEqual([]);
    expect(entries.map((entry) => entry.name).sort()).toEqual(
      Object.keys(expected).sort(),
    );

    for (const [folder, files] of Object.entries(expected)) {
      expect(readdirSync(join(adapters, folder)).sort()).toEqual(files);
    }
  });
});
