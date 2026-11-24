import { statSync } from "node:fs";
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
}

function stampOf(root: string, path: string): string {
  const stat = statSync(join(root, path), {
    bigint: true,
    throwIfNoEntry: false,
  });

  return stat === undefined ? "0:0" : `${stat.mtimeNs}:${stat.size}`;
}

export async function workingTreeFingerprint(
  ports: WorkingTreePorts,
  root: string,
): Promise<string> {
  try {
    const { entries } = await readWorkingTree(ports, root);

    return entries
      .map(({ code, path }) => `${code}:${path}:${stampOf(root, path)}`)
      .join("\n");
  } catch {
    return "";
  }
}

export class WorkingTreeWatch {
  private fingerprint = "";
  private wasActive = false;
  private reading = false;

  constructor(
    private readonly ports: WorkingTreePorts,
    private readonly root: string,
    private readonly holder: RepositoryStateHolder,
  ) {}

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

      if (next !== this.fingerprint || ended) {
        this.fingerprint = next;
        this.holder.workingTreeChanged();
      }
    } finally {
      this.reading = false;
    }
  }
}
