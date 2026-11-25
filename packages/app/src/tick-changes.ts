import type { ScanTicks, TickChange } from "@recognizer/core";

export type TickChanges = {
  change(change: TickChange): void;
};

export type TickChangesDeps = {
  ticks: () => ScanTicks;
  send: (ticks: ScanTicks, changes: TickChange[]) => Promise<ScanTicks>;
  apply: (next: ScanTicks) => void;
  failed: (error: unknown) => void;
};

export function createTickChanges(deps: TickChangesDeps): TickChanges {
  let base: ScanTicks | null = null;
  let unanswered: TickChange[] = [];
  let latest = 0;

  function settle(request: number, finish: () => void) {
    if (request !== latest) {
      return;
    }

    base = null;
    unanswered = [];
    finish();
  }

  return {
    change(change) {
      base = base ?? deps.ticks();
      unanswered = [...unanswered, change];
      latest += 1;

      const request = latest;

      deps.send(base, unanswered).then(
        (next) => settle(request, () => deps.apply(next)),
        (error) => settle(request, () => deps.failed(error)),
      );
    },
  };
}
