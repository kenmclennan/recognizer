import { describe, expect, it } from "vitest";
import {
  FIXED_INPUT_TOKENS,
  OUTPUT_TOKENS_PER_MODULE,
  projectDescribe,
  projectionText,
} from "../src/describe-projection.js";

function request(characters: number): string {
  return "x".repeat(characters - 2);
}

describe("projectDescribe", () => {
  it("sums request tokens plus the fixed part and prices them at haiku", () => {
    const projection = projectDescribe([request(3000), request(600)], "haiku");

    expect(projection).toEqual({
      modules: 2,
      model: "haiku",
      input_tokens: 1000 + FIXED_INPUT_TOKENS + (200 + FIXED_INPUT_TOKENS),
      output_tokens: 2 * OUTPUT_TOKENS_PER_MODULE,
      cost_usd: 0.0004,
    });
    expect(projection.input_tokens).toBe(3000);
    expect(projection.output_tokens).toBe(160);
  });

  it("prices claude-sonnet-5-5 and Sonnet as sonnet", () => {
    const one = [request(3000)];
    const expected = projectDescribe(one, "sonnet").cost_usd;

    expect(expected).not.toBeNull();
    expect(projectDescribe(one, "claude-sonnet-5-5").cost_usd).toBe(expected);
    expect(projectDescribe(one, "Sonnet").cost_usd).toBe(expected);
    expect(projectDescribe(one, "claude-haiku-5-5").cost_usd).toBe(
      projectDescribe(one, "haiku").cost_usd,
    );
  });

  it("gives a null cost for a model in no family", () => {
    expect(projectDescribe([request(300)], "mystery").cost_usd).toBeNull();
    expect(projectDescribe([request(300)], "haikuz").cost_usd).toBeNull();
  });

  it("projects nothing for no requests", () => {
    expect(projectDescribe([], "haiku")).toEqual({
      modules: 0,
      model: "haiku",
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    });
  });
});

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
      "projection: 2 modules, ~3000 input tokens, ~$0.0004 (haiku, API-equivalent estimate)\n",
    );
  });

  it("prints $unknown for a null cost and a bare line for no modules", () => {
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
    ).toBe("projection: 0 modules\n");
  });
});
