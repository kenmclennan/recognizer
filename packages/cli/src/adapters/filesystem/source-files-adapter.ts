import { join } from "node:path";
import type { SourceFiles } from "@recognizer/core";
import type { Io } from "../../cli.js";

export class SourceFilesAdapter implements SourceFiles {
  constructor(private readonly io: Io) {}

  readBytes(root: string, path: string): Uint8Array {
    return this.io.readBytes(join(root, path));
  }

  hashOf(root: string, path: string): string | null {
    return this.io.hashFile(join(root, path));
  }

  readText(root: string, path: string): string | null {
    try {
      return Buffer.from(this.io.readBytes(join(root, path))).toString("utf8");
    } catch {
      return null;
    }
  }
}
