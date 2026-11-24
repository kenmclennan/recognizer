import { GitSettle } from "../../domain/history/git-settle.js";
import type { WindowBaselines } from "../../domain/history/window-baselines.js";
import type { Limiter } from "../shared/limiter.js";
import type { Git } from "../shared/ports/git.js";

export interface GitWatchPorts {
  readonly git: Git;
  readonly limiter: Limiter;
}

export async function beginGitWatch(
  ports: GitWatchPorts,
  windows: WindowBaselines,
  window: string,
  root: string,
): Promise<void> {
  const snapshot = await ports.limiter.run(() => ports.git.stateSnapshot(root));

  windows.entry(window).settle = new GitSettle<string | null>(snapshot);
}

export async function pollGitWatch(
  ports: GitWatchPorts,
  windows: WindowBaselines,
  window: string,
  root: string,
): Promise<{ changed: boolean }> {
  const settle = windows.peek(window)?.settle ?? null;

  if (settle === null) {
    return { changed: false };
  }

  const snapshot = await ports.limiter.run(() => ports.git.stateSnapshot(root));

  if (snapshot === null) {
    return { changed: false };
  }

  return {
    changed: windows.peek(window)?.settle === settle && settle.poll(snapshot),
  };
}

export function endGitWatch(windows: WindowBaselines, window: string): void {
  const state = windows.peek(window);

  if (state !== undefined) {
    state.settle = null;
  }
}
