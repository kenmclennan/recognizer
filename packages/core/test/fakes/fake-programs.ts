import type {
  ProgramOnPath,
  ProgramRun,
  ProgramRunOptions,
  ProgramStartOptions,
  Programs,
  RunningProgram,
} from "../../src/index.js";

export type Behaviour = (args: string[]) => Partial<ProgramRun>;

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
      ...behaviour(args),
    };
  }

  start(
    program: string,
    args: string[],
    _options?: ProgramStartOptions,
  ): RunningProgram {
    return {
      result: Promise.resolve(this.run(program, args)),
      kill: () => {},
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
