export const LONG_FUNCTION = 20;
export const HUGE_FUNCTION = 50;

export type LengthBand = "neutral" | "long" | "huge";

const MIN_BAR_PERCENT = 6;

export function lengthBand(lines: number): LengthBand {
  if (lines > HUGE_FUNCTION) {
    return "huge";
  }

  return lines > LONG_FUNCTION ? "long" : "neutral";
}

export function functionLength(
  line: number | null | undefined,
  endLine: number | null | undefined,
): number | null {
  if (
    line === null ||
    line === undefined ||
    endLine === null ||
    endLine === undefined ||
    endLine < line
  ) {
    return null;
  }

  return endLine - line + 1;
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
