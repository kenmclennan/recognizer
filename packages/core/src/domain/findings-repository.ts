import type { Measured } from "./scan-plan.js";

export interface FindingsRepository {
  measuredOf(root: string, sensor: string): Measured | null;
  testsDigest(root: string): string | null;
  discardAnalysis(root: string, off: boolean): void;
}
