import { describe, expect, it } from "vitest";
import { BAR_HIDE_DELAY_MS, createBarHover, type Scheduler } from "./bar-hover";

function manual() {
  let now = 0;
  let next = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  const scheduler: Scheduler<number> = {
    after(fn, ms) {
      next += 1;
      tasks.set(next, { at: now + ms, fn });

      return next;
    },
    cancel(handle) {
      tasks.delete(handle);
    },
  };

  return {
    scheduler,
    pending: () => tasks.size,
    advance(ms: number) {
      now += ms;

      for (const [id, task] of [...tasks]) {
        if (task.at <= now) {
          tasks.delete(id);
          task.fn();
        }
      }
    },
  };
}

function setup() {
  const clock = manual();
  const changes: boolean[] = [];
  const hover = createBarHover(clock.scheduler as Scheduler, (visible) =>
    changes.push(visible),
  );

  return { clock, changes, hover };
}

describe("createBarHover", () => {
  it("shows on enter", () => {
    const { hover, changes } = setup();

    hover.enter();

    expect(hover.visible()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it("keeps the bar until the delay has run out", () => {
    const { hover, clock } = setup();

    hover.enter();
    hover.leave();
    clock.advance(BAR_HIDE_DELAY_MS - 1);

    expect(hover.visible()).toBe(true);
  });

  it("hides at exactly the delay", () => {
    const { hover, clock } = setup();

    hover.enter();
    hover.leave();
    clock.advance(BAR_HIDE_DELAY_MS);

    expect(hover.visible()).toBe(false);
  });

  it("keeps the bar when the pointer returns before the delay", () => {
    const { hover, clock } = setup();

    hover.enter();
    hover.leave();
    clock.advance(100);
    hover.enter();
    clock.advance(1000);

    expect(hover.visible()).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it("schedules one hide for two leaves", () => {
    const { hover, clock } = setup();

    hover.enter();
    hover.leave();
    hover.leave();

    expect(clock.pending()).toBe(1);
  });

  it("hides at once on reset and cancels a pending hide", () => {
    const { hover, clock } = setup();

    hover.enter();
    hover.leave();
    hover.reset();

    expect(hover.visible()).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  it("calls onChange only when visibility changes", () => {
    const { hover, clock, changes } = setup();

    hover.reset();
    hover.enter();
    hover.enter();
    hover.leave();
    clock.advance(BAR_HIDE_DELAY_MS);
    hover.reset();

    expect(changes).toEqual([true, false]);
  });
});
