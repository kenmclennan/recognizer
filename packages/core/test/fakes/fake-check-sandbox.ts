import type { CheckSandbox, SandboxEntry } from "../../src/index.js";

export class FakeCheckSandbox implements CheckSandbox {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  private made = 0;

  makeTempDir(): string {
    this.made += 1;

    const path = `/tmp/sandbox-${this.made}`;

    this.directories.add(path);

    return path;
  }

  readFile(path: string): string {
    const text = this.files.get(path);

    if (text === undefined) {
      throw new Error(`no file ${path}`);
    }

    return text;
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.directories.has(path);
  }

  readDir(path: string): SandboxEntry[] {
    const prefix = `${path}/`;

    return [...this.files.keys()]
      .filter((file) => file.startsWith(prefix))
      .map((file) => ({
        name: file.slice(prefix.length).split("/")[0] as string,
        kind: "file" as const,
      }));
  }

  removeDir(path: string): void {
    this.directories.delete(path);

    for (const file of [...this.files.keys()]) {
      if (file.startsWith(`${path}/`)) {
        this.files.delete(file);
      }
    }
  }
}
