export interface ForgeResult {
  readonly started: boolean;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

export interface Forge {
  run(
    root: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<ForgeResult>;
}
