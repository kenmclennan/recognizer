import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scratch } from "@recognizer/core";

export const SCRATCH_PREFIX = "recognizer-at-";

let counter = 0;

export class ScratchAdapter implements Scratch {
  constructor(private readonly root: string = tmpdir()) {}

  create(): string | null {
    counter += 1;

    const nanos = process.hrtime.bigint();
    const folder = join(
      this.root,
      `${SCRATCH_PREFIX}${process.pid}-${nanos}-${counter}`,
    );

    try {
      mkdirSync(folder, { recursive: true });

      return folder;
    } catch {
      return null;
    }
  }

  remove(folder: string): void {
    rmSync(folder, { recursive: true, force: true });
  }

  sweepStale(maxAgeMs: number): void {
    let names: string[];

    try {
      names = readdirSync(this.root);
    } catch {
      return;
    }

    const now = Date.now();

    for (const name of names) {
      if (!name.startsWith(SCRATCH_PREFIX)) {
        continue;
      }

      const path = join(this.root, name);

      try {
        if (now - statSync(path).mtimeMs > maxAgeMs) {
          rmSync(path, { recursive: true, force: true });
        }
      } catch {}
    }
  }
}
