import type { Repository } from "../../../domain/repository.js";

export interface SourceFiles {
  readBytes(root: string, path: string): Uint8Array;
  hashOf(root: string, path: string): string | null;
  testsHash(root: string, repository: Repository): string | null;
}
