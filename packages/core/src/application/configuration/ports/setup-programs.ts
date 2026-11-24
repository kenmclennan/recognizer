export interface SetupProgramRun {
  started: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  stopped?: boolean;
}

export interface SetupProgramStart {
  cwd?: string;
}

export interface RunningSetupProgram {
  result: Promise<SetupProgramRun>;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

export interface SetupPrograms {
  start(
    program: string,
    args: string[],
    options?: SetupProgramStart,
  ): RunningSetupProgram;
}
