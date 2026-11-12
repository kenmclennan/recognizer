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
