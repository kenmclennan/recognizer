import type { DescribeProjection, DescribeResult } from "@recognizer/core";

export function projectionText(projection: DescribeProjection): string {
  if (projection.modules === 0) {
    return "projection: 0 files\n";
  }

  const cost =
    projection.cost_usd === null
      ? "$unknown"
      : `$${projection.cost_usd.toFixed(4)}`;

  return `projection: ${projection.modules} files, ~${projection.input_tokens} input tokens, ~${cost} (${projection.model}, API-equivalent estimate)\n`;
}

export function describeSummaryText(result: DescribeResult): string {
  const prunedNote =
    result.pruned.length > 0 ? `, pruned ${result.pruned.length}` : "";

  const stop = result.stopped;

  if (stop === null) {
    return `described ${result.described.length}, failed ${result.failed.length}, already current ${result.current}${prunedNote}\n`;
  }

  const cause = stopCauseText(stop);

  return `stopped: ${cause}; described ${result.described.length}, failed ${result.failed.length}, not described ${stop.not_described.length}, already current ${result.current}${prunedNote}\n`;
}

export function stopCauseText(stop: {
  cause: "limit" | "failures";
  reason: string;
  threshold: number;
}): string {
  return stop.cause === "limit"
    ? `claude usage limit reached (${stop.reason})`
    : `${stop.threshold} describer calls failed in a row (last: ${stop.reason})`;
}
