import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isTestAttribute } from "../src/rust-test-blocks.js";

const CASES = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../fixtures/rust-test-gate/cases.json"),
    "utf8",
  ),
) as { attribute: string; test: boolean }[];

describe("isTestAttribute against the shared test-gate table", () => {
  it("reads a table with more than twenty cases", () => {
    expect(CASES.length).toBeGreaterThan(20);
  });

  it.each(CASES.map((c) => [c.attribute, c.test] as const))(
    "classifies %j as %s",
    (attribute, expected) => {
      expect(isTestAttribute(attribute.slice(2, -1))).toBe(expected);
    },
  );
});
