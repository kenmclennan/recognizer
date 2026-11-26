import {
  awakeClock,
  type Clock,
  MOVE_MS,
  readRuns,
  recordRun,
  scaledEstimate,
} from "./history.js";

const PREFIX = "recognizer-event ";
const UNIT = "files";
const MAX_PROGRESS_LINES = 100;

export interface Progress {
  start(total: number): void;
  advance(): void;
  finish(): void;
  complete(): void;
}

export function eventLine(event: Record<string, unknown>): string {
  return `${PREFIX}${JSON.stringify(event)}\n`;
}

export function progressTo(
  write: (text: string) => void,
  root?: string,
  clock: Clock = awakeClock(),
): Progress {
  const runs = root === undefined ? [] : readRuns(root);
  const began = clock();
  let total = 0;
  let every = 1;
  let done = 0;
  let last = -1;
  let estimated: number | null = null;
  let said = false;

  const estimate = (force: boolean) => {
    const value = scaledEstimate(runs, total, clock() - began);

    if (said && !force) {
      if (value === estimated) {
        return;
      }

      const moved =
        value === null ||
        estimated === null ||
        Math.abs(value - estimated) >= MOVE_MS;

      if (!moved) {
        return;
      }
    }

    estimated = value;
    said = true;
    write(eventLine({ event: "estimate", remaining_ms: value }));
  };

  const report = () => {
    last = done;
    write(eventLine({ event: "progress", done, total, unit: UNIT }));
    estimate(false);
  };

  return {
    start(count) {
      total = count;
      every = Math.max(1, Math.ceil(count / MAX_PROGRESS_LINES));
      done = 0;
      last = -1;
      write(eventLine({ event: "start", total, unit: UNIT }));
      estimate(true);
    },
    advance() {
      done += 1;

      if (done % every === 0) {
        report();
      }
    },
    finish() {
      if (last !== total) {
        done = total;
        report();
      }
    },
    complete() {
      if (root === undefined || total <= 0) {
        return;
      }

      recordRun(root, Math.round(clock() - began), total);
    },
  };
}
