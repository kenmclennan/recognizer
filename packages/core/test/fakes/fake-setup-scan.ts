import type { SetupScan, SetupScanOutcome } from "../../src/index.js";

export class FakeSetupScan implements SetupScan {
  outcome: SetupScanOutcome = { ok: true };
  lines: string[] = [];
  readonly calls: string[] = [];
  onExtract: () => void = () => {};

  extract(
    root: string,
    onLine: (line: string) => void,
  ): Promise<SetupScanOutcome> {
    this.calls.push(root);

    for (const line of this.lines) {
      onLine(line);
    }

    this.onExtract();

    return Promise.resolve(this.outcome);
  }
}
