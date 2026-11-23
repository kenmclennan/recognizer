import type { FindingsRepository, Measured } from "../../src/index.js";

export class FakeFindingsRepository implements FindingsRepository {
  readonly measured = new Map<string, Measured>();
  tests: string | null = null;

  measuredOf(root: string, sensor: string): Measured | null {
    return this.measured.get(`${root}::${sensor}`) ?? null;
  }

  testsDigest(): string | null {
    return this.tests;
  }

  discardAnalysis(): void {}
}
