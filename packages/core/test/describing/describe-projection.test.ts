import { describe, expect, it } from "vitest";
import {
  FIXED_INPUT_TOKENS,
  OUTPUT_TOKENS_PER_MODULE,
  projectDescribe,
} from "../../src/index.js";
import { PRICES } from "../fakes/prices.js";

function request(characters: number): string {
  return "x".repeat(characters - 2);
}

describe("projectDescribe", () => {
  it("sums request tokens plus the fixed part and prices them at haiku", () => {
    const projection = projectDescribe(
      [request(3000), request(600)],
      "haiku",
      PRICES,
    );

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
    const expected = projectDescribe(one, "sonnet", PRICES).cost_usd;

    expect(expected).not.toBeNull();
    expect(projectDescribe(one, "claude-sonnet-5-5", PRICES).cost_usd).toBe(
      expected,
    );
    expect(projectDescribe(one, "Sonnet", PRICES).cost_usd).toBe(expected);
    expect(projectDescribe(one, "claude-haiku-5-5", PRICES).cost_usd).toBe(
      projectDescribe(one, "haiku", PRICES).cost_usd,
    );
  });

  it("gives a null cost for a model in no family", () => {
    expect(
      projectDescribe([request(300)], "mystery", PRICES).cost_usd,
    ).toBeNull();
    expect(
      projectDescribe([request(300)], "haikuz", PRICES).cost_usd,
    ).toBeNull();
  });

  it("prices from the table it is handed and gives null for an unlisted model or no table", () => {
    const alpha = { alpha: { input: 1, output: 2 } };
    const one = [request(3000)];

    expect(projectDescribe(one, "alpha-1", alpha).cost_usd).not.toBeNull();
    expect(projectDescribe(one, "alpha", alpha).cost_usd).not.toBeNull();
    expect(projectDescribe(one, "beta", alpha).cost_usd).toBeNull();
    expect(projectDescribe(one, "alpha", undefined).cost_usd).toBeNull();
    expect(projectDescribe(one, "haiku", alpha).cost_usd).toBeNull();
  });

  it("projects nothing for no requests", () => {
    expect(projectDescribe([], "haiku", PRICES)).toEqual({
      modules: 0,
      model: "haiku",
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    });
  });
});
