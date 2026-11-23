import { join } from "node:path";
import type { Repository, SourceFiles } from "@recognizer/core";
import type { Io } from "../../cli.js";
import { currentTestsHash } from "../../tests-hash.js";

export class SourceFilesAdapter implements SourceFiles {
  constructor(private readonly io: Io) {}

  readBytes(root: string, path: string): Uint8Array {
    return this.io.readBytes(join(root, path));
  }

  hashOf(root: string, path: string): string | null {
    return this.io.hashFile(join(root, path));
  }

  testsHash(root: string, repository: Repository): string | null {
    return currentTestsHash(this.io, root, repository);
  }
}
