import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BEHAVIOUR, FIXTURE_LANGUAGES } from "./language-behaviour-fixture.js";

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sensors/test-files.json",
);

describe("isTestFile against the shared fixture", () => {
  const rows = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    path: string;
    test: boolean;
  }[];

  it("reads all 46 rows", () => {
    expect(rows).toHaveLength(46);
    expect(rows.filter((row) => row.test)).toHaveLength(36);
  });

  for (const row of rows) {
    it(`agrees on ${join(row.path)}`, () => {
      expect(BEHAVIOUR.isTestFile(row.path)).toBe(row.test);
    });
  }
});

describe("script extensions", () => {
  it("the typescript manifest's test-file pattern names exactly the shared fixture's script extensions", () => {
    const list = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../../../fixtures/sensors/test-file-extensions.json",
        ),
        "utf8",
      ),
    ) as string[];
    const typescript = FIXTURE_LANGUAGES.find(
      (language) => language.name === "typescript",
    );
    const pattern = typescript?.test_files?.[0]?.basename_patterns[0] ?? "";
    const named = /\(\?:test\|spec\)\\\.\(\?:([^)]*)\)\$$/.exec(pattern);

    expect(named?.[1]?.split("|")).toEqual(list);
  });

  it("recognise the repository's committed .test.mts file", () => {
    expect(
      BEHAVIOUR.isTestFile("fixtures/typescript/module-extensions/h.test.mts"),
    ).toBe(true);
  });
});
