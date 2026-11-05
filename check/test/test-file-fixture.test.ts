import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTestFile } from "../src/entry-points.js";

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sensors/test-files.json",
);

describe("isTestFile against the shared fixture", () => {
  const rows = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    path: string;
    test: boolean;
  }[];

  it("reads all 27 rows", () => {
    expect(rows).toHaveLength(27);
  });

  for (const row of rows) {
    it(`agrees on ${join(row.path)}`, () => {
      expect(isTestFile(row.path)).toBe(row.test);
    });
  }
});
