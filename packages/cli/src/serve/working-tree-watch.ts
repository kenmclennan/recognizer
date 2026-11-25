import { join } from "node:path";
import {
  type Git,
  type Limiter,
  type RepositoryStateHolder,
  readWorkingTree,
} from "@recognizer/core";

export interface WorkingTreePorts {
  git: Git;
  limiter: Limiter;
  stamp(path: string): string;
}

export async function workingTreeFingerprint(
  ports: WorkingTreePorts,
  root: string,
): Promise<string> {
  try {
    const { entries } = await readWorkingTree(ports, root);

    return entries
      .map(
        ({ code, path }) => `${code}:${path}:${ports.stamp(join(root, path))}`,
      )
      .join("\n");
  } catch {
    return "";
  }
}

const SETTLE_ATTEMPTS = 3;

export class WorkingTreeWatch {
  private fingerprint = "";
  private wasActive = false;
  private reading = false;
  private accounted = 0;

  constructor(
    private readonly ports: WorkingTreePorts,
    private readonly root: string,
    private readonly holder: RepositoryStateHolder,
  ) {}

  private async settle(first: string): Promise<string> {
    let before = first;
    let settled = false;

    try {
      for (
        let attempt = 0;
        attempt < SETTLE_ATTEMPTS && !settled;
        attempt += 1
      ) {
        this.holder.readTestsDigest();

        const after = await workingTreeFingerprint(this.ports, this.root);

        settled = after === before;
        before = settled ? before : after;
      }
    } finally {
      this.accounted = this.holder.testsDigestChanges();
      this.holder.verifyTestsDigest();
    }

    return settled ? before : first;
  }

  async tick(): Promise<void> {
    if (this.reading) {
      return;
    }

    this.reading = true;

    try {
      const next = await workingTreeFingerprint(this.ports, this.root);
      const active = this.holder.active();
      const ended = this.wasActive && !active;

      this.wasActive = active;

      const unaccounted = this.holder.testsDigestChanges() !== this.accounted;

      if (next !== this.fingerprint || ended || unaccounted) {
        this.fingerprint = await this.settle(next);
      }
    } finally {
      this.reading = false;
    }
  }
}
