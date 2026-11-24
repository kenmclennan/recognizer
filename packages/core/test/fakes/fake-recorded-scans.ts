import type { RecordedScan, RecordedScans } from "../../src/index.js";

export class FakeRecordedScans implements RecordedScans {
  scans: readonly RecordedScan[] = [];

  read(): readonly RecordedScan[] {
    return this.scans;
  }
}
