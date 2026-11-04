import { describe, expect, it } from "vitest";
import { checkDescribing } from "./settings-model";

describe("checkDescribing", () => {
  it("accepts a model and a batch size and trims the model", () => {
    expect(checkDescribing("  opus ", "8")).toEqual({
      ok: true,
      value: { model: "opus", batchSize: 8 },
    });
  });

  it.each([
    ["", "4"],
    ["-x", "4"],
    ["a b", "4"],
  ])("rejects the model %j naming Model", (model, size) => {
    const checked = checkDescribing(model, size);

    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.error).toContain("Model");
  });

  it.each(["", "0", "17", "2.5", "abc"])(
    "rejects the batch size %j naming Batch size",
    (size) => {
      const checked = checkDescribing("sonnet", size);

      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.error).toContain("Batch size");
    },
  );
});
