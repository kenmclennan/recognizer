import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { languageRules } from "../src/detect.js";
import { BREW_FIX } from "../src/preflight.js";
import { REPO } from "./helpers.js";
import { manifestOf, type RealTool, realTools } from "./plugin-tools.js";

function json(path: string): unknown {
  return JSON.parse(readFileSync(join(REPO, path), "utf8"));
}

const TOOLS = new Map<string, RealTool>(
  realTools().map((tool) => [tool.name, tool]),
);

function manifest(name: string) {
  return manifestOf(TOOLS.get(name) as RealTool);
}

describe("the shipped manifests equal the sources they transcribe", () => {
  it("holds the one table of language rules that detect.ts holds", () => {
    expect(json("fixtures/plugins/languages.json")).toEqual(languageRules());
  });

  it.each([
    ["recognizer-scan-python", "python"],
    ["recognizer-scan-typescript", "typescript"],
  ])("gives %s the detect.ts rules of %s", (command, language) => {
    const rules = languageRules().find((one) => one.name === language);

    expect(manifest(command).languages).toEqual([rules]);
  });

  it("gives every tool the install line of preflight", () => {
    for (const name of TOOLS.keys()) {
      expect(manifest(name).install).toBe(BREW_FIX);
    }
  });

  it.each([
    ["crap", true, false],
    ["mutation", true, true],
    ["thresholds", false, false],
  ])(
    "gives recognizer-sense-%s runs_tests %s and scoped %s",
    (name, runsTests, scoped) => {
      const made = manifest(`recognizer-sense-${name}`);

      expect(made.runs_tests).toBe(runsTests);
      expect(made.scoped).toBe(scoped);
    },
  );

  it("gives the sensors the time limits and unit words of today's code", () => {
    expect(manifest("recognizer-sense-thresholds")).toMatchObject({
      long_running: false,
      time_limit_seconds: 60,
      units: ["modules"],
      check: false,
    });
    expect(manifest("recognizer-describe-claude")).toMatchObject({
      long_running: false,
      time_limit_seconds: 120,
      units: ["modules"],
      check: true,
    });
    expect(manifest("recognizer-sense-crap")).toMatchObject({
      long_running: true,
      units: ["functions"],
      check: true,
    });
  });
});
