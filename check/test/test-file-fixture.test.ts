import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTestFile, SCRIPT_EXTENSIONS } from "../src/entry-points.js";

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sensors/test-files.json",
);

describe("isTestFile against the shared fixture", () => {
  const rows = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    path: string;
    test: boolean;
  }[];

  it("reads all 46 rows", () => {
    expect(rows).toHaveLength(46);
  });

  for (const row of rows) {
    it(`agrees on ${join(row.path)}`, () => {
      expect(isTestFile(row.path)).toBe(row.test);
    });
  }
});

describe("script extensions", () => {
  it("equal the shared fixture list", () => {
    const list = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../../fixtures/sensors/test-file-extensions.json",
        ),
        "utf8",
      ),
    ) as string[];

    expect(SCRIPT_EXTENSIONS).toEqual(list);
  });

  it("recognise the repository's committed .test.mts file", () => {
    expect(isTestFile("fixtures/typescript/module-extensions/h.test.mts")).toBe(
      true,
    );
  });
});
