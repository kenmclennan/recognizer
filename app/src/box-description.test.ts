import { describe, expect, it } from "vitest";
import type { Scheduler } from "./bar-hover";
import {
  BOX_DESCRIPTION_DELAY_MS,
  createDescriptionHover,
  placeDescription,
} from "./box-description";

function fakeScheduler() {
  let next = 0;
  const tasks = new Map<number, { fn: () => void; ms: number }>();
  const scheduler: Scheduler = {
    after(fn, ms) {
      next += 1;
      tasks.set(next, { fn, ms });

      return next;
    },
    cancel(handle) {
      tasks.delete(handle as number);
    },
  };

  return {
    scheduler,
    pending: () => tasks.size,
    delays: () => [...tasks.values()].map((task) => task.ms),
    fire() {
      for (const [id, task] of [...tasks]) {
        tasks.delete(id);
        task.fn();
      }
    },
  };
}

function hoverWith() {
  const clock = fakeScheduler();
  const calls: (string | null)[] = [];
  const hover = createDescriptionHover(clock.scheduler, (id) => calls.push(id));

  return { clock, calls, hover };
}

describe("createDescriptionHover", () => {
  it("shows nothing until the scheduler fires", () => {
    const { clock, calls, hover } = hoverWith();

    hover.enter("a");

    expect(calls).toEqual([]);
    expect(clock.delays()).toEqual([BOX_DESCRIPTION_DELAY_MS]);

    clock.fire();

    expect(calls).toEqual(["a"]);
    expect(hover.shown()).toBe("a");
  });

  it("shows nothing when the pointer leaves before the delay", () => {
    const { clock, calls, hover } = hoverWith();

    hover.enter("a");
    hover.leave();
    clock.fire();

    expect(calls).toEqual([]);
    expect(hover.shown()).toBeNull();
  });

  it("shows only the last box when the pointer moves between boxes", () => {
    const { clock, calls, hover } = hoverWith();

    hover.enter("a");
    hover.enter("b");
    clock.fire();

    expect(calls).toEqual(["b"]);
  });

  it("schedules once when the same box is entered twice", () => {
    const { clock, hover } = hoverWith();

    hover.enter("a");
    hover.enter("a");

    expect(clock.pending()).toBe(1);
  });

  it("does nothing when entering the box already shown", () => {
    const { clock, calls, hover } = hoverWith();

    hover.enter("a");
    clock.fire();
    hover.enter("a");

    expect(clock.pending()).toBe(0);
    expect(calls).toEqual(["a"]);
  });

  it("hides the shown box at once when another is entered", () => {
    const { clock, calls, hover } = hoverWith();

    hover.enter("a");
    clock.fire();
    hover.enter("b");

    expect(calls).toEqual(["a", null]);

    clock.fire();

    expect(calls).toEqual(["a", null, "b"]);
  });

  it("calls onChange with null when leaving after the show", () => {
    const { clock, calls, hover } = hoverWith();

    hover.enter("a");
    clock.fire();
    hover.leave();

    expect(calls).toEqual(["a", null]);
  });

  it("resets like leave", () => {
    const { clock, calls, hover } = hoverWith();

    hover.enter("a");
    clock.fire();
    hover.reset();

    expect(calls).toEqual(["a", null]);
    expect(hover.shown()).toBeNull();

    hover.enter("b");
    hover.reset();
    clock.fire();

    expect(calls).toEqual(["a", null]);
  });
});

describe("placeDescription", () => {
  const area = { top: 0, bottom: 600 };
  const boxAt = (bottom: number) => ({
    left: 40,
    width: 120,
    top: bottom - 40,
    bottom,
  });

  it("goes below the box when there is room", () => {
    expect(placeDescription(boxAt(200), 40, area, null)).toEqual({
      left: 40,
      width: 120,
      top: 208,
    });
  });

  it("fits below exactly at the boundary", () => {
    expect(placeDescription(boxAt(544), 40, area, null)?.top).toBe(552);
  });

  it("flips above one pixel past the boundary", () => {
    expect(placeDescription(boxAt(545), 40, area, null)).toEqual({
      left: 40,
      width: 120,
      top: 505 - 8 - 40,
    });
  });

  it("goes above the bar for a selected box", () => {
    const box = boxAt(560);

    expect(placeDescription(box, 40, area, { top: box.top - 30 })?.top).toBe(
      box.top - 30 - 8 - 40,
    );
  });

  it("ignores a bar below the box top", () => {
    const box = boxAt(560);

    expect(placeDescription(box, 40, area, { top: box.top + 10 })?.top).toBe(
      box.top - 8 - 40,
    );
  });

  it("returns null when neither side fits", () => {
    expect(
      placeDescription(boxAt(300), 400, { top: 0, bottom: 340 }, null),
    ).toBe(null);
  });

  it("keeps the width of the box in every case", () => {
    const cases = [
      placeDescription(boxAt(200), 40, area, null),
      placeDescription(boxAt(580), 40, area, null),
      placeDescription(boxAt(580), 40, area, { top: 500 }),
    ];

    for (const place of cases) {
      expect(place?.width).toBe(120);
      expect(place?.left).toBe(40);
    }
  });
});
