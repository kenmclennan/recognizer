import type { ScanCache, ScanFileText } from "@recognizer/core";
import type { FakeFiles } from "./io/files.js";

const SCAN_FILE = /^scan\.[^/]+\.json$/;

export class FilesScanCache implements ScanCache {
  constructor(private readonly files: FakeFiles) {}

  read(root: string): readonly ScanFileText[] {
    const folder = `${root}/.recognizer/cache`;

    if (!this.files.exists(folder)) {
      return [];
    }

    return this.files
      .readDir(folder)
      .filter((entry) => entry.kind === "file" && SCAN_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .map((file) => ({
        file,
        text: this.files.readFile(`${folder}/${file}`),
      }));
  }
}
