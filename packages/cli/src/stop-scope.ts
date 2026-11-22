import { type ChildProcess, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { type AwakeClock, systemAwakeClock } from "./awake-clock.js";
import { promotePending } from "./pending-checkpoints.js";

export const STOP_GRACE_MS = 10_000;

let sharedClock: AwakeClock | undefined;

export function awakeClock(): AwakeClock {
  sharedClock ??= systemAwakeClock();

  return sharedClock;
}

const DESCENDANT_POLL_MS = 50;

export function descendantsOf(roots: number[]): number[] {
  const listing = spawnSync("ps", ["-A", "-o", "pid=,ppid="], {
    encoding: "utf8",
  });

  if (listing.status !== 0) {
    return [];
  }

  const children = new Map<number, number[]>();

  for (const row of listing.stdout.split("\n")) {
    const [pid, parent] = row.trim().split(/\s+/).map(Number);

    if (Number.isInteger(pid) && Number.isInteger(parent)) {
      children.set(parent as number, [
        ...(children.get(parent as number) ?? []),
        pid as number,
      ]);
    }
  }

  const found: number[] = [];
  const queue = [...roots];

  while (queue.length > 0) {
    for (const pid of children.get(queue.shift() as number) ?? []) {
      if (!found.includes(pid) && !roots.includes(pid)) {
        found.push(pid);
        queue.push(pid);
      }
    }
  }

  return found;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalPid(pid: number, name: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(pid, name);
  } catch {}
}

function gone(pids: number[], cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (cancelled() || !pids.some(alive)) {
        resolve();

        return;
      }

      setTimeout(check, DESCENDANT_POLL_MS).unref();
    };

    check();
  });
}

const stoppedChildren = new WeakSet<ChildProcess>();

export function wasStopped(child: ChildProcess): boolean {
  return stoppedChildren.has(child);
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();

      return;
    }

    child.once("exit", () => resolve());
  });
}

export class StopScope {
  readonly children = new Set<ChildProcess>();
  readonly tempDirs = new Set<string>();
  readonly hooks = new Set<() => Promise<void>>();
  readonly markers = new Map<{ release(): void }, (exit: number) => void>();

  constructor(private readonly processWide: boolean = false) {}

  onStop(hook: () => Promise<void>): () => void {
    this.hooks.add(hook);

    return () => {
      this.hooks.delete(hook);
    };
  }

  releaseMarkers(exit: number): void {
    for (const one of [...this.markers.keys()]) {
      this.markers.get(one)?.(exit);
      one.release();
    }
  }

  private runHooks(): Promise<void> {
    return Promise.all([...this.hooks].map((hook) => hook())).then(
      () => undefined,
    );
  }

  private finish(): void {
    for (const directory of this.tempDirs) {
      rmSync(directory, { recursive: true, force: true });
    }

    this.tempDirs.clear();

    if (this.processWide) {
      promotePending();
    }
  }

  stop(exit: number = 143, graceMs: number = STOP_GRACE_MS): Promise<void> {
    this.releaseMarkers(exit);

    const stopping = [...this.children];

    if (stopping.length === 0) {
      if (this.hooks.size === 0) {
        this.finish();

        return Promise.resolve();
      }

      return this.runHooks().then(() => this.finish());
    }

    const roots = stopping
      .map((child) => child.pid)
      .filter((pid): pid is number => pid !== undefined);
    const descendants = descendantsOf(roots);
    let timedOut = false;

    for (const child of stopping) {
      stoppedChildren.add(child);
      child.kill("SIGTERM");
    }

    for (const pid of descendants) {
      signalPid(pid, "SIGTERM");
    }

    let cancel: (() => void) | undefined;

    return Promise.race([
      Promise.all(stopping.map(exited)).then(() =>
        gone(descendants, () => timedOut),
      ),
      new Promise<void>((resolve) => {
        cancel = awakeClock().after(graceMs, resolve);
      }),
    ]).then(() => {
      cancel?.();
      timedOut = true;

      for (const pid of descendants) {
        if (alive(pid)) {
          signalPid(pid, "SIGKILL");
        }
      }

      for (const child of stopping) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }

      return this.runHooks().then(() => this.finish());
    });
  }
}

export const processScope = new StopScope(true);

export const liveScopes = new Set<StopScope>();
