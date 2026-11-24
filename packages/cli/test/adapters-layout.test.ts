import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const adapters = resolve(here, "../src/adapters");

const expected: Record<string, string[]> = {
  filesystem: [
    "baseline-adapter.ts",
    "config-adapter.ts",
    "config-keys-adapter.ts",
    "diagnosis-translator.ts",
    "findings-adapter.ts",
    "findings-document-types.ts",
    "findings-translator.ts",
    "parsing-adapter.ts",
    "plugin-registry-adapter.ts",
    "policy-adapter.ts",
    "policy-translator.ts",
    "recorded-scans-adapter.ts",
    "repository-text.ts",
    "responsibilities-adapter.ts",
    "run-log-adapter.ts",
    "scan-cache-adapter.ts",
    "scan-document-types.ts",
    "scan-lock-adapter.ts",
    "scan-translator.ts",
    "setup-files-adapter.ts",
    "source-files-adapter.ts",
    "structure-adapter.ts",
    "view-adapter.ts",
    "view-translator.ts",
    "work-tree-adapter.ts",
    "yaml-keyed-text-adapter.ts",
  ],
  git: [
    "changes-adapter.ts",
    "forge-adapter.ts",
    "git-adapter.ts",
    "name-status-parse.ts",
  ],
  plugins: [
    "check-sandbox-adapter.ts",
    "describer-adapter.ts",
    "document-validators-adapter.ts",
    "grammar-rules-adapter.ts",
    "key-owners-adapter.ts",
    "plugin-templates-adapter.ts",
    "process-adapter.ts",
    "programs-adapter.ts",
    "published-languages-adapter.ts",
    "repository-checks-adapter.ts",
    "scanners-adapter.ts",
    "selection-files-adapter.ts",
    "sensor-catalog-adapter.ts",
    "sensors-adapter.ts",
    "sink-io.ts",
    "survey-plugins-adapter.ts",
    "test-reports-adapter.ts",
  ],
  system: [
    "assistant-adapter.ts",
    "clock-adapter.ts",
    "digest-adapter.ts",
    "scratch-adapter.ts",
    "windows-adapter.ts",
  ],
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

  it("only seven modules import the yaml library", () => {
    const sources = resolve(here, "../src");
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(directory, entry.name))
          : entry.name.endsWith(".ts")
            ? [join(directory, entry.name)]
            : [],
      );
    const importers = walk(sources)
      .filter((file) => /from "yaml"/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(file.lastIndexOf("/") + 1))
      .sort();

    expect(importers).toEqual([
      "config-adapter.ts",
      "config-parse.ts",
      "plugin-registry-adapter.ts",
      "policy-adapter.ts",
      "policy-translator.ts",
      "repository-checks-adapter.ts",
      "yaml-keyed-text-adapter.ts",
    ]);
  });
});
