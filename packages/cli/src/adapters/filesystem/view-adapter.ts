import { join } from "node:path";
import type { View, ViewRead, ViewRepository } from "@recognizer/core";
import type { Io } from "../../cli.js";
import { readViewText, serialiseView } from "./view-translator.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export class ViewAdapter implements ViewRepository {
  constructor(private readonly io: Io) {}

  names(root: string): string[] {
    try {
      return this.io
        .readDir(this.directory(root))
        .filter(
          (entry) => entry.kind === "file" && entry.name.endsWith(".json"),
        )
        .map((entry) => entry.name.slice(0, -".json".length))
        .filter((name) => NAME.test(name))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  exists(root: string, name: string): boolean {
    return this.io.exists(this.file(root, name));
  }

  read(root: string, name: string): ViewRead {
    return readViewText(this.io.readFile(this.file(root, name)), name);
  }

  write(root: string, name: string, view: View): void {
    const file = this.file(root, name);
    const temp = `${file}.tmp`;

    this.io.writeFile(temp, serialiseView(view));
    this.io.rename(temp, file);
  }

  remove(root: string, name: string): void {
    this.io.remove(this.file(root, name));
  }

  private directory(root: string): string {
    return join(root, ".recognizer", "views");
  }

  private file(root: string, name: string): string {
    return join(this.directory(root), `${name}.json`);
  }
}
