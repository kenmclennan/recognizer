import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateFindings } from "../src/findings-document.js";
import { REPO } from "./helpers.js";

const STATES = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensor-reasons/states.json"), "utf8"),
) as Record<string, unknown>;

describe("sensor-reasons fixture", () => {
  it("holds the five mock states", () => {
    expect(Object.keys(STATES)).toHaveLength(5);
  });

  for (const [state, diagnosis] of Object.entries(STATES)) {
    it(`${state} is a valid diagnosis in a findings document`, () => {
      expect(() =>
        validateFindings(
          {
            findings_version: 1,
            sensor: { name: "crap", version: "1" },
            commit: "abc123",
            modified: false,
            settings: {},
            findings: [],
            diagnosis,
          },
          { name: "crap", commit: "abc123" },
        ),
      ).not.toThrow();
    });
  }
});
