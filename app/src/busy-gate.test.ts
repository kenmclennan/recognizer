import { describe, expect, it } from "vitest";
import { createBusyGate } from "./busy-gate";

function fakeTimers() {
  const pending = new Map<number, { at: number; callback: () => void }>();
  let now = 0;
  let next = 0;

  return {
    timers: {
      set: (callback: () => void, ms: number) => {
        next += 1;
        pending.set(next, { at: now + ms, callback });

        return next;
      },
      clear: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    advance(ms: number) {
      now += ms;

      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function setup() {
  const clock = fakeTimers();
  const events: string[] = [];
  const gate = createBusyGate(
    () => events.push("show"),
    () => events.push("hide"),
    clock.timers,
  );

  return { clock, events, gate };
}

describe("busy gate", () => {
  it("never shows for an operation that ends under 200ms", () => {
    const { clock, events, gate } = setup();
    const end = gate.begin();

    clock.advance(199);
    end();
    clock.advance(1000);

    expect(events).toEqual([]);
  });

  it("shows at 200ms and hides when the operation completes", async () => {
    const { clock, events, gate } = setup();
    let finish: (value: number) => void = () => {};
    const done = gate.run(new Promise<number>((resolve) => (finish = resolve)));

    clock.advance(199);
    expect(events).toEqual([]);

    clock.advance(1);
    expect(events).toEqual(["show"]);

    finish(1);
    await done;

    expect(events).toEqual(["show", "hide"]);
  });

  it("hides when the operation fails", async () => {
    const { clock, events, gate } = setup();
    let fail: (reason: Error) => void = () => {};
    const done = gate.run(new Promise<number>((_, reject) => (fail = reject)));

    clock.advance(200);
    fail(new Error("boom"));

    await expect(done).rejects.toThrow("boom");
    expect(events).toEqual(["show", "hide"]);
  });

  it("stays shown until every overlapping operation has ended", () => {
    const { clock, events, gate } = setup();
    const first = gate.begin();
    const second = gate.begin();

    clock.advance(200);
    first();
    expect(events).toEqual(["show"]);

    second();
    second();
    expect(events).toEqual(["show", "hide"]);
  });
});
