import { describe, expect, it } from "vitest";
import { applyEdits, toValues } from "../../src/settings-values";

const STORED = {
  editor: "code",
  describing: { model: "haiku", batchSize: 4, confirmAboveUsd: 5 },
  setup: { model: "sonnet" },
};

describe("the stored machine settings as published values", () => {
  it("flattens the typed settings to values keyed by their absolute key", () => {
    expect(toValues(STORED).values).toEqual({
      editor: "code",
      "describing.model": "haiku",
      "describing.batch_size": "4",
      "describing.confirm_above_usd": "5",
      "setup.model": "sonnet",
    });
  });

  it("applies an edit to its key and leaves the others as they were", () => {
    const next = applyEdits(STORED, [
      { key: "describing.batch_size", value: 8 },
      { key: "editor", value: "zed" },
    ]);

    expect(next).toEqual({
      editor: "zed",
      describing: { model: "haiku", batchSize: 8, confirmAboveUsd: 5 },
      setup: { model: "sonnet" },
    });
    expect(STORED.describing.batchSize).toBe(4);
  });

  it("refuses a key that is not a machine setting and a value of the wrong type", () => {
    expect(() => applyEdits(STORED, [{ key: "other", value: "x" }])).toThrow(
      "other is not a machine setting",
    );
    expect(() =>
      applyEdits(STORED, [{ key: "describing.batch_size", value: "many" }]),
    ).toThrow("must be a number");
    expect(() => applyEdits(STORED, [{ key: "editor", value: 3 }])).toThrow(
      "must be text",
    );
  });
});
