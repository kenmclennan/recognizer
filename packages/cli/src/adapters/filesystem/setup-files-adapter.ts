import { join, relative } from "node:path";
import {
  type SetupDirectoryEntry,
  type SetupFiles,
  SKIPPED_DIRECTORIES,
} from "@recognizer/core";
import type { Io } from "../../cli.js";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class SetupFilesAdapter implements SetupFiles {
  constructor(private readonly io: Io) {}

  list(root: string): string[] {
    const listing = this.io.run("git", [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ]);
    const files: string[] = [];

    if (listing.started && listing.status === 0) {
      for (const path of listing.stdout.split("\0")) {
        if (path !== "" && this.io.exists(join(root, path))) {
          files.push(path);
        }
      }
    } else {
      this.walk(root, root, files);
    }

    return files;
  }

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

  private walk(root: string, directory: string, into: string[]): void {
    const entries = [...this.io.readDir(directory)].sort((a, b) =>
      compareText(a.name, b.name),
    );

    for (const entry of entries) {
      const path = join(directory, entry.name);

      if (entry.kind === "directory") {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && entry.name !== "target") {
          this.walk(root, path, into);
        }
      } else if (entry.kind === "file") {
        into.push(relative(root, path).split("\\").join("/"));
      }
    }
  }
}
