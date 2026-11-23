import type { BaselineEntry, BaselineRepository } from "@recognizer/core";
import { parseBaseline, serialiseBaseline } from "../../baseline.js";
import type { Io } from "../../cli.js";
import { InputError } from "../../errors.js";

export class BaselineAdapter implements BaselineRepository {
  constructor(private readonly io: Io) {}

  exists(path: string): boolean {
    return this.io.exists(path);
  }

  read(path: string): BaselineEntry[] {
    let text: string;

    try {
      text = this.io.readFile(path);
    } catch {
      throw new InputError([`cannot read baseline file: ${path}`]);
    }

    return parseBaseline(text);
  }

  write(path: string, entries: BaselineEntry[]): void {
    this.io.writeFile(path, serialiseBaseline(entries));
  }
}
