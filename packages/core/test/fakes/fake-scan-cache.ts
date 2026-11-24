import type { ScanCache, ScanFileText } from "../../src/index.js";

export class FakeScanCache implements ScanCache {
  readonly files = new Map<string, readonly ScanFileText[]>();
  fallback: readonly ScanFileText[] = [];

  read(root: string): readonly ScanFileText[] {
    return this.files.get(root) ?? this.fallback;
  }
}
