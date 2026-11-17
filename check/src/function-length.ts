export const LONG_FUNCTION = 20;

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

export function bodyLength(
  bodyLine: number,
  endLine: number | null | undefined,
): number | null {
  if (endLine === null || endLine === undefined || endLine < bodyLine) {
    return null;
  }

  return endLine - bodyLine + 1;
}
