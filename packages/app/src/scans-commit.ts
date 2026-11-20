import type { Scan } from "recognizer";

type RecordedScan = Scan & {
  commit?: string | null;
  modified?: boolean | null;
};

export function scansCommit(scans: Scan[]): {
  commit: string | null;
  modified: boolean;
} {
  const recorded = scans as RecordedScan[];

  return {
    commit: recorded[0]?.commit ?? null,
    modified: recorded.some((scan) => scan.modified !== false),
  };
}
