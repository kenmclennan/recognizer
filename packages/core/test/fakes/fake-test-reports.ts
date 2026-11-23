import type { TestReports } from "../../src/index.js";

export class FakeTestReports implements TestReports {
  reported: Map<string, string> | null = new Map();
  calls: string[] = [];

  entries(root: string): Map<string, string> | null {
    this.calls.push(root);

    return this.reported === null ? null : new Map(this.reported);
  }
}
