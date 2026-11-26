import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DirEntry } from "../../../src/cli.js";

interface Entry {
  bytes: Buffer;
  mode: number | undefined;
  version: number;
}

function missing(path: string): Error {
  return Object.assign(
    new Error(`ENOENT: no such file or directory, '${path}'`),
    {
      code: "ENOENT",
    },
  );
}

export class FakeFiles {
  private readonly files = new Map<string, Entry>();
  private readonly directories = new Set<string>(["/"]);
  private version = 0;
  private temporaries = 0;

  private ensureDirectory(path: string): void {
    let current = path;

    while (!this.directories.has(current)) {
      this.directories.add(current);
      current = dirname(current);
    }
  }

  private put(path: string, bytes: Buffer, mode?: number): void {
    this.ensureDirectory(dirname(path));
    this.version += 1;
    this.files.set(path, { bytes, mode, version: this.version });
  }

  seedFrom(directory: string, into: string = directory): void {
    this.ensureDirectory(into);

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      const target = join(into, entry.name);

      if (entry.isDirectory()) {
        this.seedFrom(source, target);
      } else if (entry.isFile()) {
        this.put(target, readFileSync(source), statSync(source).mode);
      }
    }
  }

  list = (prefix: string): string[] => {
    const folder = prefix.endsWith("/") ? prefix : `${prefix}/`;

    return [...this.files.keys()]
      .filter((path) => path.startsWith(folder))
      .sort();
  };

  modeOf = (path: string): number | undefined => this.files.get(path)?.mode;

  exists = (path: string): boolean =>
    this.files.has(path) || this.directories.has(path);

  readBytes = (path: string): Buffer => {
    const found = this.files.get(path);

    if (found === undefined) {
      throw missing(path);
    }

    return Buffer.from(found.bytes);
  };

  readFile = (path: string): string => this.readBytes(path).toString("utf8");

  hashFile = (path: string): string | null => {
    const found = this.files.get(path);

    return found === undefined
      ? null
      : createHash("sha256").update(found.bytes).digest("hex");
  };

  writeBytes = (path: string, bytes: Buffer, mode?: number): void => {
    this.put(path, Buffer.from(bytes), mode);
  };

  writeFile = (path: string, content: string, mode?: number): void => {
    this.put(path, Buffer.from(content, "utf8"), mode);
  };

  rename = (from: string, to: string): void => {
    const found = this.files.get(from);

    if (found === undefined) {
      throw missing(from);
    }

    this.files.delete(from);
    this.put(to, found.bytes, found.mode);
  };

  readDir = (path: string): DirEntry[] => {
    if (!this.directories.has(path)) {
      throw missing(path);
    }

    const prefix = path.endsWith("/") ? path : `${path}/`;
    const names = new Map<string, DirEntry["kind"]>();

    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length);
        const [first] = rest.split("/");

        names.set(first as string, rest.includes("/") ? "directory" : "file");
      }
    }

    for (const directory of this.directories) {
      if (directory.startsWith(prefix) && directory !== path) {
        const [first] = directory.slice(prefix.length).split("/");

        names.set(first as string, "directory");
      }
    }

    return [...names].map(([name, kind]) => ({ name, kind }));
  };

  remove = (path: string): void => {
    this.files.delete(path);
  };

  makeTempDir = (): string => {
    this.temporaries += 1;

    const path = `/fake-tmp/recognizer-scan-${this.temporaries}`;

    this.ensureDirectory(path);

    return path;
  };

  removeDir = (path: string): void => {
    const prefix = `${path}/`;

    for (const file of [...this.files.keys()]) {
      if (file.startsWith(prefix)) {
        this.files.delete(file);
      }
    }

    for (const directory of [...this.directories]) {
      if (directory === path || directory.startsWith(prefix)) {
        this.directories.delete(directory);
      }
    }
  };

  modified = (path: string): number | null => {
    const found = this.files.get(path);

    return found === undefined ? null : found.version;
  };

  createExclusive = (path: string, content: string): boolean => {
    if (this.files.has(path)) {
      return false;
    }

    this.writeFile(path, content);

    return true;
  };

  append = (path: string, content: string): void => {
    const found = this.files.get(path);

    this.put(
      path,
      Buffer.concat([found?.bytes ?? Buffer.alloc(0), Buffer.from(content)]),
      found?.mode,
    );
  };

  stamp = (path: string): string => {
    const found = this.files.get(path);

    return found === undefined
      ? "0:0"
      : `${found.version}:${found.bytes.length}`;
  };
}
