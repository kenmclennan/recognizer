import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const adapters = resolve(here, "../src/adapters");

const expected: Record<string, string[]> = {
  filesystem: [
    "baseline-adapter.ts",
    "config-adapter.ts",
    "diagnosis-translator.ts",
    "findings-adapter.ts",
    "findings-document-types.ts",
    "findings-translator.ts",
    "parsing-adapter.ts",
    "plugin-registry-adapter.ts",
    "policy-adapter.ts",
    "policy-translator.ts",
    "run-log-adapter.ts",
    "scan-document-types.ts",
    "scan-lock-adapter.ts",
    "scan-translator.ts",
    "source-files-adapter.ts",
    "structure-adapter.ts",
    "view-adapter.ts",
    "view-translator.ts",
  ],
  git: ["changes-adapter.ts", "git-adapter.ts"],
  plugins: [
    "check-sandbox-adapter.ts",
    "describer-adapter.ts",
    "document-validators-adapter.ts",
    "plugin-templates-adapter.ts",
    "process-adapter.ts",
    "programs-adapter.ts",
    "repository-checks-adapter.ts",
    "scanners-adapter.ts",
    "sensor-checks-adapter.ts",
    "sensors-adapter.ts",
    "shipped-plugins-adapter.ts",
    "sink-io.ts",
    "test-reports-adapter.ts",
  ],
  system: ["clock-adapter.ts", "digest-adapter.ts", "windows-adapter.ts"],
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
