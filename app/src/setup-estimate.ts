import { priceFor } from "recognizer";

export const SETUP_INPUT_TOKENS = { low: 100_000, high: 400_000 };
export const SETUP_OUTPUT_TOKENS = { low: 6_000, high: 24_000 };
export const BUDGET_FACTOR = 2;
export const MAX_BUDGET_USD = 100;

export type SetupEstimate = {
  lowUsd: number;
  highUsd: number;
  capUsd: number;
};

const CENT_IN_MICRO = 10_000;

type Price = { input: number; output: number };

function microUsd(input: number, output: number, price: Price): number {
  return Math.round(input * price.input + output * price.output);
}

export function setupEstimate(model: string): SetupEstimate | null {
  const price = priceFor(model);

  if (price === null) {
    return null;
  }

  const low = microUsd(SETUP_INPUT_TOKENS.low, SETUP_OUTPUT_TOKENS.low, price);
  const high = microUsd(
    SETUP_INPUT_TOKENS.high,
    SETUP_OUTPUT_TOKENS.high,
    price,
  );

  return {
    lowUsd: Math.round(low / CENT_IN_MICRO) / 100,
    highUsd: Math.round(high / CENT_IN_MICRO) / 100,
    capUsd: Math.ceil((high * BUDGET_FACTOR) / CENT_IN_MICRO) / 100,
  };
}

export function budgetFor(model: string): number | null {
  const estimate = setupEstimate(model);

  return estimate === null || !(estimate.capUsd < MAX_BUDGET_USD)
    ? null
    : estimate.capUsd;
}

export function dollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function estimateText(model: string): string {
  const estimate = setupEstimate(model);

  if (estimate === null) {
    return `No estimate for the model ${model}: it names no model family with a known price. Nothing runs until you click Check with Claude.`;
  }

  return `Typical cost with ${model}: about ${dollars(estimate.lowUsd)} to ${dollars(estimate.highUsd)}, an API-equivalent estimate and never a share of a subscription limit. The run stops at ${dollars(estimate.capUsd)}.`;
}
