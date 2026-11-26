import type { DescribeProjection } from "../scan-event.js";

export const FIXED_INPUT_TOKENS = 900;
export const OUTPUT_TOKENS_PER_MODULE = 80;
export const CHARACTERS_PER_TOKEN = 3;

export type Prices = Record<string, { input: number; output: number }>;

export function priceFor(
  model: string,
  prices: Prices | undefined,
): { input: number; output: number } | null {
  const table = prices ?? {};
  const family = Object.keys(table).find((name) =>
    new RegExp(
      `(^|[^A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
      "i",
    ).test(model),
  );

  return family === undefined
    ? null
    : (table[family] as { input: number; output: number });
}

export function projectDescribe(
  requests: unknown[],
  model: string,
  prices: Prices | undefined,
): DescribeProjection {
  const inputTokens = requests.reduce<number>(
    (total, request) =>
      total +
      Math.ceil(JSON.stringify(request).length / CHARACTERS_PER_TOKEN) +
      FIXED_INPUT_TOKENS,
    0,
  );
  const outputTokens = OUTPUT_TOKENS_PER_MODULE * requests.length;
  const price = priceFor(model, prices);

  return {
    modules: requests.length,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd:
      price === null
        ? null
        : Math.round(
            ((inputTokens * price.input + outputTokens * price.output) / 1e6) *
              1e4,
          ) / 1e4,
  };
}
