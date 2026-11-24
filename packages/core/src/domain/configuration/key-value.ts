import type { KeyEntry } from "./published-keys.js";

export type Typed = { value: string | number | boolean } | { reason: string };

export function typedValue(entry: KeyEntry, raw: string): Typed {
  const number = (): number | null =>
    /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(raw) &&
    Number.isFinite(Number(raw))
      ? Number(raw)
      : null;

  if (entry.type === "boolean") {
    return raw === "true" || raw === "false"
      ? { value: raw === "true" }
      : { reason: `${raw} is not true or false` };
  }

  if (entry.type === "enum") {
    const values = entry.values ?? [];

    return values.includes(raw)
      ? { value: raw }
      : {
          reason: `${raw} is not allowed; allowed values: ${values.join(", ")}`,
        };
  }

  if (entry.type === "integer" || entry.type === "number") {
    if (entry.off === true && raw === "false") {
      return { value: false };
    }

    if (entry.type === "integer" && !/^[+-]?\d+$/.test(raw)) {
      return { reason: `${raw} is not an integer` };
    }

    const parsed = number();

    if (parsed === null) {
      return { reason: `${raw} is not a number` };
    }

    const bound = outOfBounds(entry, parsed, raw);

    return bound === null ? { value: parsed } : { reason: bound };
  }

  if (raw === "") {
    return { reason: "must not be empty" };
  }

  if (entry.type === "path") {
    if (raw.startsWith("/")) {
      return {
        reason: `${raw} is absolute; it must be relative to the repository`,
      };
    }

    if (raw.split("/").includes("..")) {
      return { reason: `${raw} must not contain a .. segment` };
    }
  }

  return { value: raw };
}

export function outOfBounds(
  entry: KeyEntry,
  value: number,
  raw: string,
): string | null {
  if (entry.minimum !== undefined && value < entry.minimum) {
    return `${raw} is below the minimum ${entry.minimum}`;
  }

  if (entry.exclusiveMinimum !== undefined && value <= entry.exclusiveMinimum) {
    return `${raw} must be above ${entry.exclusiveMinimum}`;
  }

  if (entry.maximum !== undefined && value > entry.maximum) {
    return `${raw} is above the maximum ${entry.maximum}`;
  }

  if (entry.exclusiveMaximum !== undefined && value >= entry.exclusiveMaximum) {
    return `${raw} must be below ${entry.exclusiveMaximum}`;
  }

  return null;
}
