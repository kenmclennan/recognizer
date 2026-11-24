import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROBLEM_TITLES } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { RETIRED_KEYS as RETIRED_POLICY } from "../src/adapters/filesystem/policy-translator.js";
import { RETIRED_KEYS as RETIRED_CONFIG } from "../src/config-retired.js";
import { REPO } from "./helpers.js";

const CODES = [
  "config-yaml",
  "config-retired",
  "config-empty",
  "config-duplicate-suite",
  "config-invalid",
  "policy-invalid",
  "scan-missing",
  "scan-stale",
  "policy-entry",
  "policy-forbid",
  "policy-retired",
  "scanner-missing",
  "scanner-ambiguous",
  "scanner-choice",
  "sensor-gap",
  "plugin-missing",
  "plugin-manifest",
  "plugin-protocol",
  "plugin-scan-schema",
  "plugin-tests-report",
  "plugin-settings",
  "describer-gap",
  "unregistered-plugin",
];

const RETIRED_NAMES = [
  ...RETIRED_CONFIG.flatMap((key) => key.path),
  ...RETIRED_POLICY,
].filter((name) => name !== "sensors");

describe("problem titles", () => {
  it("every code has a plain title", () => {
    expect(CODES.length).toBeGreaterThan(0);
    expect(Object.keys(PROBLEM_TITLES).sort()).toEqual([...CODES].sort());

    for (const [code, template] of Object.entries(PROBLEM_TITLES)) {
      const title = template("x");

      expect(title.length, code).toBeGreaterThan(0);
      expect(title, code).not.toMatch(/[/._]/);
      expect(title.toLowerCase(), code).not.toContain("thresholds");
      expect(title.toLowerCase(), code).not.toContain("module");

      for (const name of RETIRED_NAMES) {
        expect(title.toLowerCase(), `${code} names ${name}`).not.toContain(
          name.toLowerCase(),
        );
      }
    }
  });

  it("problem titles name a language by the display the scanners publish", () => {
    const published = JSON.parse(
      readFileSync(join(REPO, "fixtures/plugins/languages.json"), "utf8"),
    ) as { name: string; display: string }[];
    const display = (id: string) =>
      published.find((language) => language.name === id)?.display ?? id;

    expect(published.map((language) => display(language.name))).toEqual([
      "Python",
      "TypeScript",
      "Kotlin",
      "Rust",
      "C#",
    ]);
    expect(PROBLEM_TITLES["scanner-missing"]("csharp", display)).toBe(
      "No scanner for C#",
    );
    expect(PROBLEM_TITLES["scanner-missing"]("zig", display)).toBe(
      "No scanner for zig",
    );
    expect(PROBLEM_TITLES["scanner-missing"]("scanners", display)).toBe(
      "No scanner is installed",
    );
  });
});
