export interface SandboxEntry {
  name: string;
  kind: "file" | "directory" | "other";
}

export interface CheckSandbox {
  makeTempDir(): string;
  readFile(path: string): string;
  writeFile(path: string, content: string, mode?: number): void;
  exists(path: string): boolean;
  readDir(path: string): SandboxEntry[];
  removeDir(path: string): void;
}
