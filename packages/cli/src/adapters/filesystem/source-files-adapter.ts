import { join } from "node:path";
import { SKIPPED_DIRECTORIES, type SourceFiles } from "@recognizer/core";
import type { Io } from "../../cli.js";

export class SourceFilesAdapter implements SourceFiles {
  constructor(private readonly io: Io) {}

  readBytes(root: string, path: string): Uint8Array {
    return this.io.readBytes(join(root, path));
  }

  hashOf(root: string, path: string): string | null {
    return this.io.hashFile(join(root, path));
  }

  listFiles(root: string): string[] | null {
    const listed = this.io.run("git", [
      "-C",
      root,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
      ":!.recognizer",
    ]);

    if (!listed.started || listed.status !== 0) {
      return this.walked(root);
    }

    return listed.stdout.split("\0").filter((path) => path !== "");
  }

  private walked(root: string): string[] | null {
    const found: string[] = [];

    try {
      this.walk(root, "", found);
    } catch {
      return null;
    }

    return found;
  }

  private walk(root: string, directory: string, into: string[]): void {
    for (const entry of this.io.readDir(join(root, directory))) {
      const path = directory === "" ? entry.name : `${directory}/${entry.name}`;

      if (entry.kind === "directory") {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          this.walk(root, path, into);
        }
      } else if (entry.kind === "file") {
        into.push(path);
      }
    }
  }

  readText(root: string, path: string): string | null {
    try {
      return Buffer.from(this.io.readBytes(join(root, path))).toString("utf8");
    } catch {
      return null;
    }
  }
}
