import type { Forge, ForgeResult } from "../../src/index.js";

export class FakeForge implements Forge {
  readonly calls: {
    root: string;
    args: readonly string[];
    timeoutMs: number;
  }[] = [];
  result: ForgeResult = { started: true, status: 0, stdout: "[]", stderr: "" };

  async run(
    root: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<ForgeResult> {
    this.calls.push({ root, args, timeoutMs });

    return this.result;
  }
}
