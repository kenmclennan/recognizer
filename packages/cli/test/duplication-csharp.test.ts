import { describe, expect, it } from "vitest";
import { DEFAULT_DUPLICATION_SETTINGS } from "../src/duplication/findings.js";
import { measureDuplication } from "../src/duplication/measure.js";
import { allParsers, measuredFixture, ROOT } from "./duplication-helpers.js";

describe("duplication", () => {
  it("measures C# fixtures without dotnet installed", async () => {
    const original = process.env.PATH;

    process.env.PATH = "/nonexistent";

    try {
      const { fake, scans } = measuredFixture(
        "fixtures/duplication/corpus/csharp",
      );
      const findings = measureDuplication(
        fake.io,
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
      );

      expect(findings).toHaveLength(7);
    } finally {
      process.env.PATH = original;
    }
  });
});
