export const MAX_BATCH_SIZE = 16;

export type DescribingValues = { model: string; batchSize: number };

export type DescribingCheck =
  | { ok: true; value: DescribingValues }
  | { ok: false; error: string };

export function checkDescribing(
  model: string,
  batchSize: string,
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

  return { ok: true, value: { model: name, batchSize: size } };
}
