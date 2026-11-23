import type { CheckSandbox, SandboxEntry } from "@recognizer/core";
import type { Io } from "../../cli.js";

export class CheckSandboxAdapter implements CheckSandbox {
  constructor(private readonly io: Io) {}

  makeTempDir(): string {
    return this.io.makeTempDir();
  }

  readFile(path: string): string {
    return this.io.readFile(path);
  }

  writeFile(path: string, content: string, mode?: number): void {
    this.io.writeFile(path, content, mode);
  }

  exists(path: string): boolean {
    return this.io.exists(path);
  }

  readDir(path: string): SandboxEntry[] {
    return this.io.readDir(path);
  }

  removeDir(path: string): void {
    this.io.removeDir(path);
  }
}
