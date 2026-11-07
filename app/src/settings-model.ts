export const MAX_BATCH_SIZE = 16;
export const MAX_CONFIRM_ABOVE_USD = 10000;

export type DescribingValues = {
  model: string;
  batchSize: number;
  confirmAboveUsd: number;
};

export type DescribingCheck =
  | { ok: true; value: DescribingValues }
  | { ok: false; error: string };

export function checkDescribing(
  model: string,
  batchSize: string,
  confirmAbove: string,
): DescribingCheck {
  const name = model.trim();

  if (name === "" || name.startsWith("-") || /\s/.test(name)) {
    return {
      ok: false,
      error:
        "Model must be a name with no spaces and no leading - (for example haiku)",
    };
  }

  const size = Number(batchSize);

  if (
    batchSize.trim() === "" ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > MAX_BATCH_SIZE
  ) {
    return {
      ok: false,
      error: `Batch size must be a whole number from 1 to ${MAX_BATCH_SIZE}`,
    };
  }

  const amount = Number(confirmAbove);

  if (
    confirmAbove.trim() === "" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_CONFIRM_ABOVE_USD
  ) {
    return {
      ok: false,
      error: `Ask above must be a number of dollars from 0 to ${MAX_CONFIRM_ABOVE_USD}`,
    };
  }

  return {
    ok: true,
    value: { model: name, batchSize: size, confirmAboveUsd: amount },
  };
}
