export interface SetupDirectoryEntry {
  name: string;
  kind: "file" | "directory" | "other";
}

export interface SetupFiles {
  list(root: string): string[];
  text(path: string): string | null;
  exists(path: string): boolean;
  children(directory: string): SetupDirectoryEntry[] | null;
  write(path: string, text: string): void;
  remove(path: string): void;
}
