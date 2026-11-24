import {
  DEFAULT_DUPLICATION_SETTINGS,
  measureDuplication,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { analysisPortsOf, sayOf } from "./analysis-ports.js";
import {
  allParsers,
  GRAMMAR_RULES,
  measuredFixture,
  ROOT,
} from "./duplication-helpers.js";

describe("duplication", () => {
  it("measures C# fixtures without dotnet installed", async () => {
    const original = process.env.PATH;

    process.env.PATH = "/nonexistent";

    try {
      const { fake, scans } = measuredFixture(
        "fixtures/duplication/corpus/csharp",
      );
      const findings = measureDuplication(
        analysisPortsOf(fake.io),
        sayOf(fake.io),
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
        GRAMMAR_RULES,
      );

      expect(findings).toHaveLength(7);
    } finally {
      process.env.PATH = original;
    }
  });
});
