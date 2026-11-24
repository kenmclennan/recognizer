export interface Responsibility {
  readonly line: string;
  readonly sourceHash: string;
  readonly describer: readonly string[];
  readonly version: string;
}

export type LineStatusReason = "source" | "describer" | "version";

export type LineStatus =
  | { status: "missing" }
  | { status: "current" }
  | { status: "out-of-date"; reasons: LineStatusReason[] };

function versionMatches(
  recorded: string,
  current: string,
  describer: readonly string[],
): boolean {
  if (recorded === current) {
    return true;
  }

  return (
    describer.some((item) => item.includes("{model}")) &&
    recorded.startsWith(`${current}+`)
  );
}

export function lineStatus(
  entry: Responsibility | undefined,
  sourceHash: string,
  describer: readonly string[],
  version: string,
): LineStatus {
  if (entry === undefined) {
    return { status: "missing" };
  }

  const reasons: LineStatusReason[] = [];

  if (entry.sourceHash !== sourceHash) {
    reasons.push("source");
  }

  if (JSON.stringify(entry.describer) !== JSON.stringify(describer)) {
    reasons.push("describer");
  }

  if (!versionMatches(entry.version, version, describer)) {
    reasons.push("version");
  }

  return reasons.length === 0
    ? { status: "current" }
    : { status: "out-of-date", reasons };
}
