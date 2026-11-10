import { describe, expect, it } from "vitest";
import type { Scheduler } from "./bar-hover";
import {
  BOX_DESCRIPTION_DELAY_MS,
  createDescriptionHover,
  descriptionSurvives,
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
  const area = { left: 0, right: 1000, top: 0, bottom: 600 };
  const boxAt = (bottom: number, left = 400, width = 120) => ({
    left,
    width,
    top: bottom - 40,
    bottom,
  });

  it("is 320 wide and centred under the box with no note", () => {
    expect(placeDescription(boxAt(200), 40, area, null)).toEqual({
      left: 300,
      width: 320,
      top: 208,
    });
  });

  it("is 320 wide whatever the box width", () => {
    expect(placeDescription(boxAt(200, 400, 600), 40, area, null)?.width).toBe(
      320,
    );
  });

  it("is never wider than the canvas less its margins", () => {
    const narrow = { left: 0, right: 200, top: 0, bottom: 600 };

    expect(placeDescription(boxAt(200, 40, 120), 40, narrow, null)).toEqual({
      left: 8,
      width: 184,
      top: 208,
    });
  });

  it("aligns its right edge with the box when the note is on the right", () => {
    expect(placeDescription(boxAt(200), 40, area, null, "right")).toEqual({
      left: 200,
      width: 320,
      top: 208,
    });
  });

  it("aligns its left edge with the box when the note is on the left", () => {
    expect(placeDescription(boxAt(200), 40, area, null, "left")).toEqual({
      left: 400,
      width: 320,
      top: 208,
    });
  });

  it("is pulled back inside the canvas at the left", () => {
    expect(placeDescription(boxAt(200, 20), 40, area, null)?.left).toBe(8);
    expect(
      placeDescription(boxAt(200, 20), 40, area, null, "right")?.left,
    ).toBe(8);
  });

  it("is pulled back inside the canvas at the right", () => {
    expect(placeDescription(boxAt(200, 880), 40, area, null)?.left).toBe(672);
    expect(
      placeDescription(boxAt(200, 880), 40, area, null, "left")?.left,
    ).toBe(672);
  });

  it("honours a canvas that does not start at zero", () => {
    const offset = { left: 100, right: 700, top: 0, bottom: 600 };

    expect(placeDescription(boxAt(200, 100), 40, offset, null)?.left).toBe(108);
  });

  it("fits below exactly at the boundary", () => {
    expect(placeDescription(boxAt(544), 40, area, null)?.top).toBe(552);
  });

  it("flips above one pixel past the boundary", () => {
    expect(placeDescription(boxAt(545), 40, area, null)?.top).toBe(
      505 - 8 - 40,
    );
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
      placeDescription(
        boxAt(300),
        400,
        { left: 0, right: 1000, top: 0, bottom: 340 },
        null,
      ),
    ).toBe(null);
  });
});

describe("descriptionSurvives", () => {
  it("keeps a held description when nothing relevant changed", () => {
    expect(descriptionSurvives("a", false, true, "t", "t")).toBe(true);
  });

  it("resets when nothing is held", () => {
    expect(descriptionSurvives(null, false, true, null, null)).toBe(false);
  });

  it("resets when the scene was redrawn", () => {
    expect(descriptionSurvives("a", true, true, "t", "t")).toBe(false);
  });

  it("resets when the selection changed", () => {
    expect(descriptionSurvives("a", false, false, "t", "t")).toBe(false);
  });

  it("resets when the held box's text changed", () => {
    expect(descriptionSurvives("a", false, true, "t", "u")).toBe(false);
  });
});

describe("DescriptionHover.held", () => {
  it("reports the pending id, the shown id and null after leave", () => {
    const { clock, hover } = hoverWith();

    expect(hover.held()).toBeNull();

    hover.enter("a");

    expect(hover.held()).toBe("a");

    clock.fire();

    expect(hover.held()).toBe("a");

    hover.leave();

    expect(hover.held()).toBeNull();
  });
});
