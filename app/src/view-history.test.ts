import { describe, expect, it } from "vitest";
import { createHistory, HISTORY_LIMIT } from "./view-history";

describe("history", () => {
  it("walks back and forward over recorded states", () => {
    const history = createHistory("a");

    history.record("b");
    history.record("c");

    expect(history.back()).toBe("b");
    expect(history.back()).toBe("a");
    expect(history.forward()).toBe("b");
    expect(history.canForward()).toBe(true);
  });

  it("drops the forward tail on a record after going back", () => {
    const history = createHistory("a");

    history.record("b");
    history.back();
    history.record("c");

    expect(history.canForward()).toBe(false);
    expect(history.back()).toBe("a");
    expect(history.forward()).toBe("c");
  });

  it("ignores a record deeply equal to the current entry", () => {
    const history = createHistory({ x: [1] });

    history.record({ x: [1] });

    expect(history.canBack()).toBe(false);
  });

  it("returns null at either end", () => {
    const history = createHistory("a");

    expect(history.back()).toBeNull();
    expect(history.forward()).toBeNull();
    expect(history.canBack()).toBe(false);
  });

  it("keeps at most 200 entries by dropping the first", () => {
    const history = createHistory(0);

    for (let n = 1; n <= HISTORY_LIMIT; n += 1) {
      history.record(n);
    }

    let oldest = HISTORY_LIMIT;

    for (let back = history.back(); back !== null; back = history.back()) {
      oldest = back;
    }

    expect(HISTORY_LIMIT).toBe(200);
    expect(oldest).toBe(1);
  });

  it("rewrites every recorded state when remapped", () => {
    const history = createHistory(1);

    history.record(2);
    history.record(3);
    history.remap((n) => n * 10);

    expect(history.back()).toBe(20);
    expect(history.back()).toBe(10);
  });

  it("stores a mark beside each entry and reads it after back and forward", () => {
    const history = createHistory("a");
    const mark = { by: "Claude", summary: "added 4 modules" };

    expect(history.markNow()).toBeNull();

    history.record("b", mark);
    history.record("c");

    expect(history.markNow()).toBeNull();

    history.back();

    expect(history.markNow()).toEqual(mark);
    expect(history.markNext()).toBeNull();

    history.back();

    expect(history.markNow()).toBeNull();
    expect(history.markNext()).toEqual(mark);
  });

  it("adds nothing for a no-op record, marked or not", () => {
    const history = createHistory({ x: 1 });

    expect(history.record({ x: 1 }, { by: "Claude", summary: "s" })).toBe(
      false,
    );
    expect(history.canBack()).toBe(false);
    expect(history.record({ x: 2 })).toBe(true);
  });

  it("keeps marks through a remap", () => {
    const history = createHistory(1);
    const mark = { by: "Claude", summary: "s" };

    history.record(2, mark);
    history.remap((n) => n * 10);

    expect(history.markNow()).toEqual(mark);
    expect(history.back()).toBe(10);
    expect(history.forward()).toBe(20);
  });

  it("keeps marks aligned when the limit drops the oldest entry", () => {
    const history = createHistory(0);
    const mark = { by: "Claude", summary: "s" };

    for (let n = 1; n <= HISTORY_LIMIT; n += 1) {
      history.record(n);
    }

    history.record(HISTORY_LIMIT + 1, mark);

    expect(history.markNow()).toEqual(mark);

    history.back();

    expect(history.markNow()).toBeNull();
    expect(history.markNext()).toEqual(mark);
  });
});
