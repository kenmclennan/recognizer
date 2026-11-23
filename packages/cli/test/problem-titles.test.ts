import { LANGUAGE_NAMES, PROBLEM_TITLES } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { RETIRED_KEYS as RETIRED_POLICY } from "../src/adapters/filesystem/policy-translator.js";
import { RETIRED_KEYS as RETIRED_CONFIG } from "../src/config-retired.js";

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

  it("language names match the app", () => {
    expect(LANGUAGE_NAMES).toEqual({
      typescript: "TypeScript",
      rust: "Rust",
      python: "Python",
      kotlin: "Kotlin",
      csharp: "C#",
    });
    expect(PROBLEM_TITLES["scanner-missing"]("csharp")).toBe(
      "No scanner for C#",
    );
    expect(PROBLEM_TITLES["scanner-missing"]("zig")).toBe("No scanner for zig");
    expect(PROBLEM_TITLES["scanner-missing"]("scanners")).toBe(
      "No scanner is installed",
    );
  });
});
