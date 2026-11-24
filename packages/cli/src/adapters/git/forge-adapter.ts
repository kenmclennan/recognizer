import type { Forge, ForgeResult } from "@recognizer/core";
import type { Io } from "../../cli.js";

export class ForgeAdapter implements Forge {
  constructor(private readonly io: Io) {}

  async run(
    root: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<ForgeResult> {
    const result = await this.io.runAsync("gh", [...args], {
      cwd: root,
      timeoutMs,
    }).result;

    return {
      started: result.started,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut === true,
    };
  }
}
