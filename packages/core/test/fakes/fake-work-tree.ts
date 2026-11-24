import { createHash } from "node:crypto";
import type { FileStamp, WorkTree } from "../../src/index.js";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class FakeWorkTree implements WorkTree {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readonly hashed: string[] = [];
  private readonly versions = new Map<string, number>();

  write(relative: string, text: string): void {
    this.files.set(relative, text);
    this.versions.set(relative, (this.versions.get(relative) ?? 0) + 1);
  }

  remove(relative: string): void {
    this.files.delete(relative);
  }

  async isFile(_root: string, relative: string): Promise<boolean> {
    return this.files.has(relative);
  }

  async stamp(_root: string, relative: string): Promise<FileStamp | null> {
    const text = this.files.get(relative);

    return text === undefined
      ? null
      : {
          modified: this.versions.get(relative) ?? 0,
          length: Buffer.byteLength(text),
        };
  }

  async hash(_root: string, relative: string): Promise<string | null> {
    const text = this.files.get(relative);

    if (text === undefined) {
      return null;
    }

    this.hashed.push(relative);

    return sha256(text);
  }

  async exists(_root: string, relative: string): Promise<boolean> {
    return (
      this.files.has(relative) ||
      this.directories.has(relative) ||
      [...this.files.keys()].some((path) => path.startsWith(`${relative}/`))
    );
  }

  async walk(
    _root: string,
    _relative: string,
    descend: (path: string) => Promise<boolean>,
  ): Promise<readonly string[]> {
    const found: string[] = [];

    for (const path of [...this.files.keys()].sort()) {
      const parts = path.split("/").slice(0, -1);
      let directory = "";
      let reachable = true;

      for (const part of parts) {
        directory = directory === "" ? part : `${directory}/${part}`;

        if (!(await descend(directory))) {
          reachable = false;
          break;
        }
      }

      if (reachable) {
        found.push(path);
      }
    }

    return found;
  }
}
