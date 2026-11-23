import { resolve } from "node:path";
import type { SelectionFileRead, SelectionFiles } from "@recognizer/core";
import type { Io } from "../../cli.js";

export class SelectionFilesAdapter implements SelectionFiles {
  constructor(private readonly io: Io) {}

  read(file: string): SelectionFileRead {
    try {
      return { ok: true, text: this.io.readFile(resolve(file)) };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  absolute(file: string): string {
    return resolve(file);
  }
}
