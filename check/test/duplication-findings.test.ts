import { describe, expect, it } from "vitest";
import { DEFAULT_DUPLICATION_SETTINGS } from "../src/duplication/findings.js";
import { measureDuplication } from "../src/duplication/measure.js";
import {
  allParsers,
  EQUIVALENCE,
  measuredFixture,
  ROOT,
  readJson,
} from "./duplication-helpers.js";

const CASES: [string, string][] = [
  ["python", "fixtures/duplication/corpus/python"],
  ["typescript", "fixtures/duplication/corpus/typescript"],
  ["kotlin", "fixtures/duplication/corpus/kotlin"],
  ["rust", "fixtures/duplication/corpus/rust"],
  ["csharp", "fixtures/duplication/corpus/csharp"],
  ["sample", "fixtures/duplication/sample"],
  ["crap-corpus", "fixtures/crap/corpus"],
];

describe("duplication findings against the Python sensor's goldens", () => {
  for (const [name, directory] of CASES) {
    it(`gives the golden findings for ${name}`, async () => {
      const golden = readJson<unknown[]>(
        `${EQUIVALENCE}/findings.${name}.json`,
      );
      const { fake, scans } = measuredFixture(directory);

      if (!["sample", "crap-corpus"].includes(name)) {
        expect(golden.length).toBeGreaterThan(0);
      }

      const findings = measureDuplication(
        fake.io,
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
      );

      expect(findings).toEqual(golden);
      expect(fake.err()).toBe("");
    });
  }
});
