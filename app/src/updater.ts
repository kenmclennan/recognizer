export type UpdateState =
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string };

export type FoundUpdate = { version: string; install: () => Promise<void> };

export type CheckOutcome =
  | { kind: "found"; version: string }
  | { kind: "up-to-date" }
  | { kind: "failed"; reason: string }
  | { kind: "installing"; version: string };

export type InstallResult = { ok: true } | { ok: false; reason: string };

export const DISABLED_REASON = "updates are not available in this build";

export type UpdaterPorts = {
  enabled: boolean;
  check: () => Promise<FoundUpdate | null>;
  relaunch: () => Promise<void>;
  schedule: (run: () => void, ms: number) => () => void;
  scheduleEvery: (run: () => void, ms: number) => () => void;
  onState: (state: UpdateState) => void;
  notify: (text: string) => void;
};

export const FIRST_CHECK_MS = 30 * 1000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function buildUpdater(ports: UpdaterPorts): {
  start: () => void;
  install: () => Promise<InstallResult>;
  checkNow: () => Promise<CheckOutcome>;
  state: () => UpdateState;
} {
  let state: UpdateState = { kind: "none" };
  let found: FoundUpdate | null = null;

  function isInstalling(): boolean {
    return state.kind === "installing";
  }

  function installingVersion(): string | null {
    return state.kind === "installing" ? state.version : null;
  }

  function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function setState(next: UpdateState): void {
    state = next;
    ports.onState(next);
  }

  async function runCheck(): Promise<void> {
    if (isInstalling()) {
      return;
    }

    try {
      const update = await ports.check();

      if (update !== null && !isInstalling()) {
        found = update;
        setState({ kind: "available", version: update.version });
      }
    } catch {
      return;
    }
  }

  async function checkNow(): Promise<CheckOutcome> {
    const before = installingVersion();

    if (before !== null) {
      return { kind: "installing", version: before };
    }

    if (!ports.enabled) {
      return { kind: "failed", reason: DISABLED_REASON };
    }

    try {
      const update = await ports.check();
      const during = installingVersion();

      if (during !== null) {
        return { kind: "installing", version: during };
      }

      if (update === null) {
        return { kind: "up-to-date" };
      }

      found = update;
      setState({ kind: "available", version: update.version });

      return { kind: "found", version: update.version };
    } catch (error) {
      return { kind: "failed", reason: reasonOf(error) };
    }
  }

  return {
    checkNow,
    state: () => state,
    start() {
      if (!ports.enabled) {
        return;
      }

      ports.schedule(() => void runCheck(), FIRST_CHECK_MS);
      ports.scheduleEvery(() => void runCheck(), CHECK_EVERY_MS);
    },
    async install(): Promise<InstallResult> {
      if (state.kind !== "available" || found === null) {
        return { ok: false, reason: "no update is available" };
      }

      const update = found;

      setState({ kind: "installing", version: update.version });

      try {
        await update.install();
        await ports.relaunch();

        return { ok: true };
      } catch (error) {
        setState({ kind: "available", version: update.version });
        ports.notify(`Update failed: ${reasonOf(error)}`);

        return { ok: false, reason: reasonOf(error) };
      }
    },
  };
}
