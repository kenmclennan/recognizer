import type { Timers } from "./layout-source";

export const BUSY_DELAY_MS = 200;

export type BusyGate = {
  begin: () => () => void;
  run: <T>(operation: Promise<T>) => Promise<T>;
};

const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createBusyGate(
  show: () => void,
  hide: () => void,
  timers: Timers = realTimers,
  delayMs = BUSY_DELAY_MS,
): BusyGate {
  let running = 0;
  let waiting: unknown = null;
  let shown = false;

  function begin() {
    running += 1;

    if (running === 1) {
      waiting = timers.set(() => {
        waiting = null;
        shown = true;
        show();
      }, delayMs);
    }

    let ended = false;

    return () => {
      if (ended) {
        return;
      }

      ended = true;
      running -= 1;

      if (running > 0) {
        return;
      }

      if (waiting !== null) {
        timers.clear(waiting);
        waiting = null;
      }

      if (shown) {
        shown = false;
        hide();
      }
    };
  }

  return {
    begin,
    run(operation) {
      const end = begin();

      return operation.finally(end);
    },
  };
}
