import { describe, expect, it, vi } from "vitest";
import type { StaleReport } from "./stale-report";
import { createViewComparisons } from "./view-comparisons";

const empty: StaleReport = {
  missing: [],
  changed: { removed: [], added: [] },
  newlyRelevant: [],
  unavailable: null,
};

const drifted: StaleReport = { ...empty, newlyRelevant: ["a/b.py"] };

function input(
  name: string,
  viewCommit: string,
  scanCommit: string,
  run: () => Promise<StaleReport>,
) {
  return { name, title: name, viewCommit, scanCommit, run };
}

describe("createViewComparisons", () => {
  it("runs one pair once, in flight and after it settled, and posts once", async () => {
    const comparisons = createViewComparisons();
    const run = vi.fn(async () => drifted);
    const post = vi.fn();
    const first = comparisons.compare(input("v", "c1", "c2", run), post);
    const second = comparisons.compare(input("v", "c1", "c2", run), post);

    await Promise.all([first, second]);
    await comparisons.compare(input("v", "c1", "c2", run), post);

    expect(run).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["scan commit", "v", "c1", "c3"],
    ["view commit", "v", "c0", "c2"],
    ["view name", "w", "c1", "c2"],
  ])(
    "runs again for another %s",
    async (_what, name, viewCommit, scanCommit) => {
      const comparisons = createViewComparisons();
      const run = vi.fn(async () => drifted);

      await comparisons.compare(input("v", "c1", "c2", run), vi.fn());
      await comparisons.compare(
        input(name, viewCommit, scanCommit, run),
        vi.fn(),
      );

      expect(run).toHaveBeenCalledTimes(2);
    },
  );

  it("remembers a failed comparison", async () => {
    const comparisons = createViewComparisons();
    const failed = { ...empty, unavailable: "no" };
    const run = vi.fn(async () => failed);
    const post = vi.fn();

    await comparisons.compare(input("v", "c1", "c2", run), post);
    await comparisons.compare(input("v", "c1", "c2", run), post);

    expect(run).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(comparisons.settled("v", "c1", "c2")).toBe(failed);
  });

  it("holds the keys of entries with a message for that scan commit only", async () => {
    const comparisons = createViewComparisons();

    await comparisons.compare(
      input("v", "c1", "c2", async () => drifted),
      vi.fn(),
    );
    await comparisons.compare(
      input("w", "c1", "c2", async () => empty),
      vi.fn(),
    );
    await comparisons.compare(
      input("x", "c1", "c3", async () => drifted),
      vi.fn(),
    );

    expect(comparisons.heldKeys("c2")).toEqual(["view-stale:v:c1:c2"]);
    expect(comparisons.heldKeys("c3")).toEqual(["view-stale:x:c1:c3"]);
  });

  it("drops only the named view", async () => {
    const comparisons = createViewComparisons();

    await comparisons.compare(
      input("v", "c1", "c2", async () => drifted),
      vi.fn(),
    );
    await comparisons.compare(
      input("w", "c1", "c2", async () => drifted),
      vi.fn(),
    );
    comparisons.drop("v");

    expect(comparisons.heldKeys("c2")).toEqual(["view-stale:w:c1:c2"]);
    expect(comparisons.settled("v", "c1", "c2")).toBeNull();
  });

  it("fetches renames once per pair and refetches after a drop", async () => {
    const comparisons = createViewComparisons();
    const fetch = vi.fn(async () => []);

    await comparisons.renames("v", "c1", "c2", fetch);
    await comparisons.renames("v", "c1", "c2", fetch);
    comparisons.drop("v");
    await comparisons.renames("v", "c1", "c2", fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("routes an update request to the registered handler only", () => {
    const comparisons = createViewComparisons();
    const handler = vi.fn();

    comparisons.requestUpdate("v");

    const stop = comparisons.onUpdate(handler);

    comparisons.requestUpdate("v");
    stop();
    comparisons.requestUpdate("v");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("v");
  });
});
