import type {
  ProgramOnPath,
  ProgramRun,
  ProgramRunOptions,
  ProgramStartOptions,
  Programs,
  RunningProgram,
} from "../../src/index.js";

export type Behaviour = (
  args: string[],
  options?: ProgramRunOptions,
) => Partial<ProgramRun>;

export interface RecordedRun {
  program: string;
  args: string[];
  options: ProgramRunOptions | undefined;
}

const NOT_STARTED: ProgramRun = {
  started: false,
  status: null,
  stdout: "",
  stderr: "",
};

export class FakePrograms implements Programs {
  readonly path: string[] = [];
  readonly files = new Map<string, string[]>();
  readonly unreadable = new Set<string>();
  readonly behaviours = new Map<string, Behaviour>();
  readonly runs: RecordedRun[] = [];
  readonly timers: { ms: number; run: () => void }[] = [];

  install(directory: string, name: string, behaviour: Behaviour): void {
    if (!this.path.includes(directory)) {
      this.path.push(directory);
    }

    this.files.set(directory, [...(this.files.get(directory) ?? []), name]);
    this.behaviours.set(`${directory}/${name}`, behaviour);
  }

  find(name: string): string | null {
    for (const directory of this.path) {
      if ((this.files.get(directory) ?? []).includes(name)) {
        return `${directory}/${name}`;
      }
    }

    return null;
  }

  listOnPath(prefixes: readonly string[]): ProgramOnPath[] {
    const seen = new Set<string>();
    const found: ProgramOnPath[] = [];

    for (const directory of this.path) {
      if (this.unreadable.has(directory)) {
        continue;
      }

      for (const name of this.files.get(directory) ?? []) {
        if (
          !seen.has(name) &&
          prefixes.some((prefix) => name.startsWith(prefix))
        ) {
          seen.add(name);
          found.push({ name, directory });
        }
      }
    }

    return found;
  }

  run(
    program: string,
    args: string[],
    options?: ProgramRunOptions,
  ): ProgramRun {
    this.runs.push({ program, args, options });

    const behaviour = this.behaviours.get(program);

    if (behaviour === undefined) {
      return { ...NOT_STARTED };
    }

    return {
      started: true,
      status: 0,
      stdout: "",
      stderr: "",
      ...behaviour(args, options),
    };
  }

  readonly held = new Set<string>();
  readonly started: { program: string; args: string[]; cwd?: string }[] = [];
  readonly pending: ((run: ProgramRun) => void)[] = [];
  killed = 0;

  start(
    program: string,
    args: string[],
    options?: ProgramStartOptions,
  ): RunningProgram {
    const cwd = options?.cwd;

    this.started.push({ program, args, ...(cwd === undefined ? {} : { cwd }) });

    if (this.held.has(program)) {
      this.runs.push({ program, args, options });

      let release: (run: ProgramRun) => void = () => {};
      const result = new Promise<ProgramRun>((resolve) => {
        release = resolve;
      });

      this.pending.push(release);

      return {
        result,
        kill: () => {
          this.killed += 1;
          release({
            started: true,
            status: null,
            stdout: "",
            stderr: "",
            stopped: true,
          });
        },
      };
    }

    return {
      result: Promise.resolve(
        this.run(program, args, cwd === undefined ? undefined : { cwd }),
      ),
      kill: () => {
        this.killed += 1;
      },
    };
  }

  after(ms: number, run: () => void): () => void {
    const timer = { ms, run };

    this.timers.push(timer);

    return () => {
      this.timers.splice(this.timers.indexOf(timer), 1);
    };
  }
}
