import type { SelectionFileRead, SelectionFiles } from "../../src/index.js";

export class FakeSelectionFiles implements SelectionFiles {
  readonly files = new Map<string, string>();

  read(file: string): SelectionFileRead {
    const text = this.files.get(file);

    return text === undefined
      ? { ok: false, reason: "ENOENT" }
      : { ok: true, text };
  }

  absolute(file: string): string {
    return `/abs/${file}`;
  }
}
