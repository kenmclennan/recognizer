import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKeySchema } from "../src/config-keys.js";
import { parseConfig } from "../src/config-parse.js";
import { REPO } from "./helpers.js";

describe("the pinned sensors key schema", () => {
  const parsed = parseKeySchema(
    readFileSync(join(REPO, "fixtures/sensors/config-keys.json"), "utf8"),
  );

  it("validates against the key schema and publishes the defaults of the table", () => {
    expect("schema" in parsed).toBe(true);

    const keys = new Map(
      ("schema" in parsed ? parsed.schema.keys : []).map((entry) => [
        entry.key,
        entry,
      ]),
    );

    expect(keys.get("sensors.crap.threshold")?.default).toBe(30);
    expect(keys.get("sensors.mutation.timeout_factor")?.default).toBe(10);
    expect(keys.get("sensors.mutation.incremental")?.default).toBe(true);
    expect(keys.get("sensors.crap.coverage_limit")?.default).toBe(0.6);
    expect(keys.get("sensors.crap.coverage_limit")?.replaces).toBe(
      "sensors.thresholds.coverage.below",
    );
    expect(keys.get("sensors.mutation.max_minutes")?.default_text).toBe(
      "no time budget: the run continues until it finishes",
    );
    expect(keys.get("sensors.mutation.max_workers")?.default_text).toBe(
      "half the machine's cores, fewer if free memory is short",
    );

    const defaulted = [...keys.values()].filter(
      (entry) =>
        entry.default !== undefined ||
        entry.defaults !== undefined ||
        entry.default_text !== undefined,
    );

    expect(defaulted).toHaveLength(6);
  });
});

describe("the committed .recognizer/config.yaml", () => {
  const text = readFileSync(join(REPO, ".recognizer/config.yaml"), "utf8");

  it.each([["all"], [["describer"]], [["sensors"]], [[]]] as const)(
    "parses with read %j",
    (read) => {
      expect(() => parseConfig(text, read)).not.toThrow();
    },
  );

  it("reads all as the whole-file parse", () => {
    expect(parseConfig(text, "all")).toEqual(parseConfig(text));
  });
});
