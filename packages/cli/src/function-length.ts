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

export function measuredLength(
  line: number | null | undefined,
  bodyLine: number | null | undefined,
  endLine: number | null | undefined,
): number | null {
  const span = functionLength(line, endLine);

  if (span === null || bodyLine === null || bodyLine === undefined) {
    return span;
  }

  return bodyLength(bodyLine, endLine);
}

export const COMPLEXITY_LIMIT = 10;
