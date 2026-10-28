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
});
