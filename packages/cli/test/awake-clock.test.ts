import { describe, expect, it } from "vitest";
import { createAwakeClock } from "../src/awake-clock.js";

const HOUR = 3_600_000;

function harness() {
  let wall = 1_000_000;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();

  const clock = createAwakeClock<number>({
    read: () => wall,
    setTimer: (fn, ms) => {
      const id = nextId++;

      pending.set(id, { at: wall + ms, fn });

      return id;
    },
    clearTimer: (id) => {
      pending.delete(id);
    },
    tickMs: 1000,
    gapMs: 10_000,
  });

  const advance = (ms: number) => {
    wall += ms;
  };

  const fireDue = () => {
    for (const [id, timer] of [...pending]) {
      if (timer.at <= wall) {
        pending.delete(id);
        timer.fn();
      }
    }
  };

  return { clock, advance, fireDue, pending };
}

describe("awake clock", () => {
  it("a sleep gap is not counted", () => {
    const { clock, advance } = harness();
    const before = clock.now();

    advance(8 * HOUR);

    expect(clock.now() - before).toBe(1000);
  });

  it("a gap below the threshold counts as awake", () => {
    const { clock, advance } = harness();
    const before = clock.now();

    advance(5000);

    expect(clock.now() - before).toBe(5000);
  });

  it("a gap exactly at the threshold counts as awake", () => {
    const { clock, advance } = harness();
    const before = clock.now();

    advance(10_000);

    expect(clock.now() - before).toBe(10_000);
  });

  it("a gap one millisecond past the threshold is slept", () => {
    const { clock, advance } = harness();
    const before = clock.now();

    advance(10_001);

    expect(clock.now() - before).toBe(1000);
  });

  it("after waits out awake time only", () => {
    const { clock, advance, fireDue, pending } = harness();
    let ran = 0;

    clock.after(60_000, () => {
      ran += 1;
    });

    advance(8 * HOUR);
    fireDue();

    expect(ran).toBe(0);
    expect(pending.size).toBe(1);

    for (let tick = 0; tick < 60; tick += 1) {
      advance(1000);
      clock.now();
      fireDue();
    }

    expect(ran).toBe(1);
  });

  it("clear cancels the timer", () => {
    const { clock, pending } = harness();
    const cancel = clock.after(60_000, () => {});

    expect(pending.size).toBe(1);

    cancel();

    expect(pending.size).toBe(0);
  });

  it("the heartbeat sees a sleep nothing else read", () => {
    const { clock, advance, fireDue, pending } = harness();

    clock.start();
    advance(8 * HOUR);
    fireDue();

    expect(pending.size).toBe(1);

    advance(1000);

    expect(clock.now() - 1_000_000).toBeLessThan(10_000);

    clock.stop();

    expect(pending.size).toBe(0);
  });
});
