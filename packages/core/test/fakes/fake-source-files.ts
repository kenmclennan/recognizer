import type { Repository, SourceFiles } from "../../src/index.js";

export class FakeSourceFiles implements SourceFiles {
  readonly files = new Map<string, string>();
  readonly hashes = new Map<string, string>();
  tests: string | null = null;

  readBytes(root: string, path: string): Uint8Array {
    const text = this.files.get(`${root}/${path}`);

    if (text === undefined) {
      throw new Error(`no file ${path}`);
    }

    return new TextEncoder().encode(text);
  }

  hashOf(root: string, path: string): string | null {
    return this.hashes.get(`${root}/${path}`) ?? null;
  }

  testsHash(_root: string, _repository: Repository): string | null {
    return this.tests;
  }
}
