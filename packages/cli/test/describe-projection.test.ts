import { describe, expect, it } from "vitest";
import { projectionText } from "../src/describe-projection.js";

describe("projectionText", () => {
  it("prints the counts, the cost and the model as an API-equivalent estimate", () => {
    expect(
      projectionText({
        modules: 2,
        model: "haiku",
        input_tokens: 3000,
        output_tokens: 160,
        cost_usd: 0.0004,
      }),
    ).toBe(
      "projection: 2 files, ~3000 input tokens, ~$0.0004 (haiku, API-equivalent estimate)\n",
    );
  });

  it("prints $unknown for a null cost and a bare line for no files", () => {
    expect(
      projectionText({
        modules: 1,
        model: "mystery",
        input_tokens: 901,
        output_tokens: 80,
        cost_usd: null,
      }),
    ).toContain("~$unknown (mystery,");
    expect(
      projectionText({
        modules: 0,
        model: "haiku",
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
      }),
    ).toBe("projection: 0 files\n");
  });
});
