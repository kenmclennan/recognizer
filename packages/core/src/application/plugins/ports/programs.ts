export interface ProgramRun {
  started: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  stopped?: boolean;
}

export interface ProgramRunOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface ProgramStartOptions {
  cwd?: string;
  onStderrLine?: (line: string) => void;
}

export interface RunningProgram {
  result: Promise<ProgramRun>;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

export interface ProgramOnPath {
  name: string;
  directory: string;
}

export interface Programs {
  find(name: string): string | null;
  listOnPath(prefixes: readonly string[]): ProgramOnPath[];
  unreadableOnPath(): string[];
  run(program: string, args: string[], options?: ProgramRunOptions): ProgramRun;
  start(
    program: string,
    args: string[],
    options?: ProgramStartOptions,
  ): RunningProgram;
  after(ms: number, run: () => void): () => void;
}
