import { functionLength, LONG_FUNCTION } from "recognizer";

export { functionLength, LONG_FUNCTION };

export const HUGE_FUNCTION = 50;

export type LengthBand = "neutral" | "long" | "huge";

const MIN_BAR_PERCENT = 6;

export function lengthBand(
  lines: number,
  longAt: number = LONG_FUNCTION,
): LengthBand {
  if (lines > HUGE_FUNCTION) {
    return "huge";
  }

  return lines > longAt ? "long" : "neutral";
}

export function barPercent(lines: number, largest: number): number {
  if (largest <= 0) {
    return MIN_BAR_PERCENT;
  }

  return Math.max(
    MIN_BAR_PERCENT,
    Math.round((Math.min(lines, largest) / largest) * 100),
  );
}

export function lengthText(lines: number): string {
  return lines === 1 ? "1 line" : `${lines} lines`;
}
