import type { BaselineEntry, BaselineRepository } from "../../src/index.js";

export class FakeBaselineRepository implements BaselineRepository {
  readonly baselines = new Map<string, BaselineEntry[]>();
  textHash = "";

  hash(): string {
    return this.textHash;
  }

  exists(path: string): boolean {
    return this.baselines.has(path);
  }

  read(path: string): BaselineEntry[] {
    const entries = this.baselines.get(path);

    if (entries === undefined) {
      throw new Error(`no baseline at ${path}`);
    }

    return entries;
  }

  write(path: string, entries: BaselineEntry[]): void {
    this.baselines.set(path, entries);
  }
}
