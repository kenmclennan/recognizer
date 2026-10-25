export type UpdateState =
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string };

export type FoundUpdate = { version: string; install: () => Promise<void> };

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
  install: () => Promise<void>;
} {
  let state: UpdateState = { kind: "none" };
  let found: FoundUpdate | null = null;

  function isInstalling(): boolean {
    return state.kind === "installing";
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

  return {
    start() {
      if (!ports.enabled) {
        return;
      }

      ports.schedule(() => void runCheck(), FIRST_CHECK_MS);
      ports.scheduleEvery(() => void runCheck(), CHECK_EVERY_MS);
    },
    async install() {
      if (state.kind !== "available" || found === null) {
        return;
      }

      const update = found;

      setState({ kind: "installing", version: update.version });

      try {
        await update.install();
        await ports.relaunch();
      } catch (error) {
        setState({ kind: "available", version: update.version });
        ports.notify(
          `Update failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
