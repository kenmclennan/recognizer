import { describe, expect, it } from "vitest";
import { thresholdsMigration } from "../../src/domain/configuration/thresholds-migration.js";

const KEYS = [
  {
    key: "x.limit",
    type: "number" as const,
    exclusiveMinimum: 0,
    maximum: 1,
    off: true,
    default: 0.6,
    replaces: "sensors.thresholds.cov.below",
  },
];

const NO_OFF = [{ ...KEYS[0], off: undefined }];

const migrate = (
  document: unknown,
  keys: Parameters<typeof thresholdsMigration>[2] = KEYS,
) => {
  const result = thresholdsMigration(document, (command) => command, keys);

  expect(result).not.toBeNull();

  return result as { line: string; command: string };
};

const UNSET = "recognizer config --unset sensors.thresholds";

describe("thresholdsMigration over published keys", () => {
  it("moves a value to the key that replaces the field", () => {
    const result = migrate({
      sensors: { thresholds: { cov: { below: 0.7 } } },
    });

    expect(result.command).toBe(`recognizer config x.limit 0.7 && ${UNSET}`);
  });

  it("gives no step for the key's default", () => {
    const result = migrate({
      sensors: { thresholds: { cov: { below: 0.6 } } },
    });

    expect(result.command).toBe(UNSET);
  });

  it("names the reason a value is refused", () => {
    const result = migrate({ sensors: { thresholds: { cov: { below: 5 } } } });

    expect(result.line).toContain(
      "cov.below 5 is dropped: 5 is above the maximum 1",
    );
    expect(result.command).toBe(UNSET);
  });

  it("switches the key off when the entry is off and the key allows it", () => {
    const result = migrate({ sensors: { thresholds: { cov: "off" } } });

    expect(result.command).toBe(`recognizer config x.limit false && ${UNSET}`);
  });

  it("notes that off has no equivalent when the key cannot be switched off", () => {
    const result = migrate({ sensors: { thresholds: { cov: "off" } } }, NO_OFF);

    expect(result.line).toContain(
      "cov: off has no equivalent for x.limit and is dropped",
    );
    expect(result.command).toBe(UNSET);
  });

  it("leaves a key already set alone", () => {
    const result = migrate({
      x: { limit: 0.9 },
      sensors: { thresholds: { cov: { below: 0.7 } } },
    });

    expect(result.line).toContain("x.limit is already set and is left alone");
    expect(result.command).toBe(UNSET);
  });

  it("drops an entry with no usable form", () => {
    const result = migrate({ sensors: { thresholds: { cov: 3 } } });

    expect(result.line).toContain("cov had no usable form and is dropped");
  });

  it("drops a value that is not a single value", () => {
    const result = migrate({
      sensors: { thresholds: { cov: { below: [1] } } },
    });

    expect(result.line).toContain(
      "cov.below [1] is dropped: it is not a single value",
    );
  });

  it("drops every other field of the entry", () => {
    const result = migrate({
      sensors: {
        thresholds: { cov: { below: 0.7, above: 2, severity: "violation" } },
      },
    });

    expect(result.line).toContain(
      "cov.above 2 is dropped: no setting replaces it",
    );
    expect(result.line).toContain(
      'cov.severity "violation" is dropped: no setting replaces it',
    );
    expect(result.command).toBe(`recognizer config x.limit 0.7 && ${UNSET}`);
  });

  it("drops an entry no published key replaces", () => {
    const result = migrate(
      { sensors: { thresholds: { churn: { above: 3 }, cov: { below: 0.7 } } } },
      [],
    );

    expect(result.line).toContain("churn has no replacement and is dropped");
    expect(result.line).toContain("cov has no replacement and is dropped");
    expect(result.command).toBe(UNSET);
  });

  it("ignores a published key with replaces but no type", () => {
    const result = migrate(
      { sensors: { thresholds: { cov: { below: 0.7 } } } },
      [{ key: "x.limit", replaces: "sensors.thresholds.cov.below" }],
    );

    expect(result.line).toContain("cov has no replacement and is dropped");
  });

  it("keeps section order across published, core and dropped entries", () => {
    const result = migrate({
      sensors: {
        thresholds: {
          cov: { below: 0.7 },
          churn: { above: 3 },
          complexity: { above: 15 },
        },
      },
    });

    expect(result.command).toBe(
      `recognizer config x.limit 0.7 && recognizer config sensors.structure.warnings.complexity.limit 15 && ${UNSET}`,
    );
    expect(result.line).toContain("churn has no replacement and is dropped");
  });
});
