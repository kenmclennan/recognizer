import { describe, expect, it } from "vitest";
import { checkDescribing } from "./settings-model";

describe("checkDescribing", () => {
  it("accepts a model and a batch size and trims the model", () => {
    expect(checkDescribing("  opus ", "8", "2.50")).toEqual({
      ok: true,
      value: { model: "opus", batchSize: 8, confirmAboveUsd: 2.5 },
    });
  });

  it.each([
    ["", "4"],
    ["-x", "4"],
    ["a b", "4"],
  ])("rejects the model %j naming Model", (model, size) => {
    const checked = checkDescribing(model, size, "5");

    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.error).toContain("Model");
  });

  it.each(["", "0", "17", "2.5", "abc"])(
    "rejects the batch size %j naming Batch size",
    (size) => {
      const checked = checkDescribing("sonnet", size, "5");

      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.error).toContain("Batch size");
    },
  );

  it.each(["0", "10000", "0.5"])("accepts the threshold %j", (amount) => {
    expect(checkDescribing("haiku", "4", amount).ok).toBe(true);
  });

  it.each(["", "-1", "10001", "abc", "NaN"])(
    "rejects the threshold %j naming Confirm above",
    (amount) => {
      const checked = checkDescribing("haiku", "4", amount);

      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.error).toContain("Confirm above");
    },
  );
});
