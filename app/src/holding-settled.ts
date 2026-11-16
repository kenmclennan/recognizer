export const NO_RESULT_MESSAGE = "The scan ended and left no result to show";

export function settledMessage(
  holdingShown: boolean,
  explorerShown: boolean,
): string | null {
  return holdingShown && !explorerShown ? NO_RESULT_MESSAGE : null;
}
