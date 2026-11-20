export interface AwakeClock {
  now(): number;
  after(ms: number, fn: () => void): () => void;
  start(): void;
  stop(): void;
}

export interface AwakeClockOptions<Timer> {
  read: () => number;
  setTimer: (fn: () => void, ms: number) => Timer;
  clearTimer: (timer: Timer) => void;
  setBeatTimer?: (fn: () => void, ms: number) => Timer;
  tickMs?: number;
  gapMs?: number;
}

export const AWAKE_TICK_MS = 1000;

export const AWAKE_GAP_MS = 10_000;

export function createAwakeClock<Timer>(
  options: AwakeClockOptions<Timer>,
): AwakeClock {
  const tickMs = options.tickMs ?? AWAKE_TICK_MS;
  const gapMs = options.gapMs ?? AWAKE_GAP_MS;
  const setBeatTimer = options.setBeatTimer ?? options.setTimer;

  let last = options.read();
  let slept = 0;
  let heartbeat: Timer | undefined;
  let running = false;

  const sync = (): void => {
    const current = options.read();
    const elapsed = current - last;

    if (elapsed > gapMs) {
      slept += elapsed - tickMs;
    }

    last = current;
  };

  const now = (): number => {
    sync();

    return last - slept;
  };

  const beat = (): void => {
    sync();

    if (running) {
      heartbeat = setBeatTimer(beat, tickMs);
    }
  };

  const after = (ms: number, fn: () => void): (() => void) => {
    const began = now();

    let timer: Timer | undefined;
    let cleared = false;

    const arm = (remaining: number): void => {
      timer = options.setTimer(() => {
        timer = undefined;

        if (cleared) {
          return;
        }

        const left = ms - (now() - began);

        if (left > 0) {
          arm(left);

          return;
        }

        fn();
      }, remaining);
    };

    arm(ms);

    return () => {
      cleared = true;

      if (timer !== undefined) {
        options.clearTimer(timer);
        timer = undefined;
      }
    };
  };

  return {
    now,
    after,
    start: () => {
      if (running) {
        return;
      }

      running = true;
      sync();
      heartbeat = setBeatTimer(beat, tickMs);
    },
    stop: () => {
      running = false;

      if (heartbeat !== undefined) {
        options.clearTimer(heartbeat);
        heartbeat = undefined;
      }
    },
  };
}

export function systemAwakeClock(): AwakeClock {
  const clock = createAwakeClock<NodeJS.Timeout>({
    read: () => Number(process.hrtime.bigint() / 1_000_000n),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    setBeatTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);

      timer.unref();

      return timer;
    },
    clearTimer: (timer) => clearTimeout(timer),
  });

  clock.start();

  return clock;
}
