import type { SourceFiles } from "../../src/index.js";

export class FakeSourceFiles implements SourceFiles {
  readonly files = new Map<string, string>();
  readonly hashes = new Map<string, string>();
  readonly calls: string[] = [];
  listed: string[] | null = null;

  readBytes(root: string, path: string): Uint8Array {
    this.calls.push(`readBytes ${path}`);

    const text = this.files.get(`${root}/${path}`);

    if (text === undefined) {
      throw new Error(`no file ${path}`);
    }

    return new TextEncoder().encode(text);
  }

  hashOf(root: string, path: string): string | null {
    this.calls.push(`hashOf ${path}`);

    return this.hashes.get(`${root}/${path}`) ?? null;
  }

  listFiles(_root: string): string[] | null {
    this.calls.push("listFiles");

    return this.listed;
  }

  readText(root: string, path: string): string | null {
    return this.files.get(`${root}/${path}`) ?? null;
  }
}
