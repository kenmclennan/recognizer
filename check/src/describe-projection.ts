export const FIXED_INPUT_TOKENS = 900;
export const OUTPUT_TOKENS_PER_MODULE = 80;
export const CHARACTERS_PER_TOKEN = 3;

export const PRICES_PER_MILLION: Record<
  string,
  { input: number; output: number }
> = {
  haiku: { input: 0.1, output: 0.5 },
  sonnet: { input: 2, output: 10 },
  opus: { input: 4, output: 20 },
};

export interface DescribeProjection {
  modules: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

function priceFor(model: string): { input: number; output: number } | null {
  const family = Object.keys(PRICES_PER_MILLION).find((name) =>
    new RegExp(`(^|[^A-Za-z0-9])${name}([^A-Za-z0-9]|$)`, "i").test(model),
  );

  return family === undefined
    ? null
    : (PRICES_PER_MILLION[family] as { input: number; output: number });
}

export function projectDescribe(
  requests: unknown[],
  model: string,
): DescribeProjection {
  const inputTokens = requests.reduce<number>(
    (total, request) =>
      total +
      Math.ceil(JSON.stringify(request).length / CHARACTERS_PER_TOKEN) +
      FIXED_INPUT_TOKENS,
    0,
  );
  const outputTokens = OUTPUT_TOKENS_PER_MODULE * requests.length;
  const price = priceFor(model);

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

export function projectionText(projection: DescribeProjection): string {
  if (projection.modules === 0) {
    return "projection: 0 modules\n";
  }

  const cost =
    projection.cost_usd === null
      ? "$unknown"
      : `$${projection.cost_usd.toFixed(4)}`;

  return `projection: ${projection.modules} modules, ~${projection.input_tokens} input tokens, ~${cost} (${projection.model}, API-equivalent estimate)\n`;
}
