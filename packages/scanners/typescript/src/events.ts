const PREFIX = "recognizer-event ";
const UNIT = "files";
const MAX_PROGRESS_LINES = 100;

export interface Progress {
  start(total: number): void;
  advance(): void;
  finish(): void;
}

export function eventLine(event: Record<string, unknown>): string {
  return `${PREFIX}${JSON.stringify(event)}\n`;
}

export function progressTo(write: (text: string) => void): Progress {
  let total = 0;
  let every = 1;
  let done = 0;
  let last = -1;

  const report = () => {
    last = done;
    write(eventLine({ event: "progress", done, total, unit: UNIT }));
  };

  return {
    start(count) {
      total = count;
      every = Math.max(1, Math.ceil(count / MAX_PROGRESS_LINES));
      done = 0;
      last = -1;
      write(eventLine({ event: "start", total, unit: UNIT }));
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
  };
}
