export interface SourceFiles {
  readBytes(root: string, path: string): Uint8Array;
  hashOf(root: string, path: string): string | null;
  listFiles(root: string): string[] | null;
  readText(root: string, path: string): string | null;
}
