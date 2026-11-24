import type { SetupDirectoryEntry, SetupFiles } from "../../src/index.js";

function parentOf(path: string): string {
  const at = path.lastIndexOf("/");

  return at <= 0 ? "/" : path.slice(0, at);
}

export class FakeSetupFiles implements SetupFiles {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  seed(path: string, text: string): void {
    this.files.set(path, text);
  }

  directory(path: string): void {
    this.directories.add(path);
  }

  list(root: string): string[] {
    const prefix = root.endsWith("/") ? root : `${root}/`;

    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .sort();
  }

  text(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.isDirectory(path);
  }

  children(directory: string): SetupDirectoryEntry[] | null {
    if (!this.isDirectory(directory)) {
      return null;
    }

    const prefix = directory.endsWith("/") ? directory : `${directory}/`;
    const found = new Map<string, SetupDirectoryEntry["kind"]>();

    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const [name, ...rest] = path.slice(prefix.length).split("/");

        found.set(name as string, rest.length === 0 ? "file" : "directory");
      }
    }

    for (const path of this.directories) {
      if (path.startsWith(prefix) && path !== directory) {
        const [name] = path.slice(prefix.length).split("/");

        found.set(name as string, "directory");
      }
    }

    return [...found].map(([name, kind]) => ({ name, kind }));
  }

  write(path: string, text: string): void {
    this.files.set(path, text);
    this.directories.add(parentOf(path));
  }

  remove(path: string): void {
    this.files.delete(path);
  }

  snapshot(): string {
    return JSON.stringify([...this.files].sort());
  }

  private isDirectory(path: string): boolean {
    const prefix = path.endsWith("/") ? path : `${path}/`;

    return (
      this.directories.has(path) ||
      [...this.files.keys()].some((file) => file.startsWith(prefix)) ||
      [...this.directories].some((one) => one.startsWith(prefix))
    );
  }
}
