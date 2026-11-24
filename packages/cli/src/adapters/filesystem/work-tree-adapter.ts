import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileStamp, WorkTree } from "@recognizer/core";

export class WorkTreeAdapter implements WorkTree {
  async isFile(root: string, relative: string): Promise<boolean> {
    try {
      return (await stat(join(root, relative))).isFile();
    } catch {
      return false;
    }
  }

  async stamp(root: string, relative: string): Promise<FileStamp | null> {
    try {
      const meta = await stat(join(root, relative));

      return meta.isFile()
        ? { modified: meta.mtimeMs, length: meta.size }
        : null;
    } catch {
      return null;
    }
  }

  async hash(root: string, relative: string): Promise<string | null> {
    try {
      return createHash("sha256")
        .update(await readFile(join(root, relative)))
        .digest("hex");
    } catch {
      return null;
    }
  }

  async exists(root: string, relative: string): Promise<boolean> {
    try {
      await stat(join(root, relative));

      return true;
    } catch {
      return false;
    }
  }

  async walk(
    root: string,
    relative: string,
    descend: (path: string) => Promise<boolean>,
  ): Promise<readonly string[]> {
    let entries: import("node:fs").Dirent[];

    try {
      entries = await readdir(join(root, relative), { withFileTypes: true });
    } catch {
      return [];
    }

    const found: string[] = [];

    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        if (await descend(path)) {
          found.push(...(await this.walk(root, path, descend)));
        }
      } else if (entry.isFile()) {
        found.push(path);
      }
    }

    return found;
  }
}
