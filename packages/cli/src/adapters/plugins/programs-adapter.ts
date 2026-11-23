import {
  joinPath,
  type ProgramOnPath,
  type ProgramRun,
  type ProgramRunOptions,
  type ProgramStartOptions,
  type Programs,
  type RunningProgram,
} from "@recognizer/core";
import type { Io } from "../../cli.js";

export class ProgramsAdapter implements Programs {
  constructor(private readonly io: Io) {}

  private directories(): string[] {
    return (this.io.env("PATH") ?? "").split(":").filter((one) => one !== "");
  }

  find(name: string): string | null {
    for (const directory of this.directories()) {
      const path = joinPath(directory, name);

      if (this.io.exists(path)) {
        return path;
      }
    }

    return null;
  }

  listOnPath(prefixes: readonly string[]): ProgramOnPath[] {
    const seen = new Set<string>();
    const found: ProgramOnPath[] = [];

    for (const directory of this.directories()) {
      let entries: ReturnType<Io["readDir"]>;

      try {
        entries = this.io.readDir(directory);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (
          entry.kind === "directory" ||
          seen.has(entry.name) ||
          !prefixes.some((prefix) => entry.name.startsWith(prefix))
        ) {
          continue;
        }

        seen.add(entry.name);
        found.push({ name: entry.name, directory });
      }
    }

    return found;
  }

  run(
    program: string,
    args: string[],
    options: ProgramRunOptions = {},
  ): ProgramRun {
    return this.io.run(program, args, options);
  }

  start(
    program: string,
    args: string[],
    options: ProgramStartOptions = {},
  ): RunningProgram {
    return this.io.runAsync(program, args, options);
  }

  after(ms: number, run: () => void): () => void {
    const timer = setTimeout(run, ms);

    return () => clearTimeout(timer);
  }
}
