import { describe, expect, it } from "vitest";
import { RETIRED_KEYS as RETIRED_CONFIG } from "../src/config-retired.js";
import { RETIRED_KEYS as RETIRED_POLICY } from "../src/policy.js";
import { PROBLEM_TITLES } from "../src/problem-titles.js";

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
    expect(Object.keys(PROBLEM_TITLES).sort()).toEqual([...CODES].sort());

    for (const [code, title] of Object.entries(PROBLEM_TITLES)) {
      expect(title.length, code).toBeGreaterThan(0);
      expect(title, code).not.toMatch(/[/._]/);

      for (const name of RETIRED_NAMES) {
        expect(title.toLowerCase(), `${code} names ${name}`).not.toContain(
          name.toLowerCase(),
        );
      }
    }
  });
});
