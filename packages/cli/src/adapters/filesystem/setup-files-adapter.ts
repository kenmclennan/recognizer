import type { SetupDirectoryEntry, SetupFiles } from "@recognizer/core";
import type { Io } from "../../cli.js";

export class SetupFilesAdapter implements SetupFiles {
  constructor(private readonly io: Io) {}

  text(path: string): string | null {
    try {
      return this.io.readBytes(path).toString("utf8");
    } catch {
      return null;
    }
  }

  exists(path: string): boolean {
    return this.io.exists(path);
  }

  children(directory: string): SetupDirectoryEntry[] | null {
    try {
      return this.io.readDir(directory);
    } catch {
      return null;
    }
  }

  write(path: string, text: string): void {
    this.io.writeFile(path, text);
  }

  remove(path: string): void {
    this.io.remove(path);
  }
}
