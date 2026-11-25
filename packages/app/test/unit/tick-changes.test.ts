import type { ScanTicks, TickChange } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { createTickChanges } from "../../src/tick-changes";

const START: ScanTicks = {
  describe: false,
  analysis: true,
  ticked: null,
  armed: [],
  onlyView: false,
  suites: {},
  folds: [],
};

function held() {
  let release: (ticks: ScanTicks) => void = () => {};
  const promise = new Promise<ScanTicks>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

describe("tick changes", () => {
  it("a second change is sent with the first, from the ticks before either", async () => {
    const sent: { ticks: ScanTicks; changes: TickChange[] }[] = [];
    const applied: ScanTicks[] = [];
    const first = held();
    const second = held();
    const replies = [first, second];
    const changes = createTickChanges({
      ticks: () => START,
      send: (ticks, list) => {
        sent.push({ ticks, changes: list });

        return replies[sent.length - 1]?.promise ?? Promise.reject();
      },
      apply: (next) => applied.push(next),
      failed: () => {},
    });

    changes.change({ kind: "describe", ticked: true });
    changes.change({ kind: "fold", sensor: "crap" });

    expect(sent.map((one) => one.changes.length)).toEqual([1, 2]);
    expect(sent.every((one) => one.ticks === START)).toBe(true);

    const both = { ...START, describe: true, folds: ["crap"] };

    second.release(both);
    await second.promise;
    first.release({ ...START, describe: true });
    await first.promise;

    expect(applied).toEqual([both]);
  });

  it("a change after a settled reply starts from the ticks then held", async () => {
    let current = START;
    const bases: ScanTicks[] = [];
    const changes = createTickChanges({
      ticks: () => current,
      send: async (ticks) => {
        bases.push(ticks);

        return { ...ticks, describe: !ticks.describe };
      },
      apply: (next) => {
        current = next;
      },
      failed: () => {},
    });

    changes.change({ kind: "describe", ticked: true });
    await Promise.resolve();
    await Promise.resolve();
    changes.change({ kind: "describe", ticked: false });

    expect(bases[1]?.describe).toBe(true);
  });

  it("a refused request is reported once and the next change starts fresh", async () => {
    const failures: unknown[] = [];
    const changes = createTickChanges({
      ticks: () => START,
      send: () => Promise.reject(new Error("no service")),
      apply: () => {},
      failed: (error) => failures.push(error),
    });

    changes.change({ kind: "open" });
    await Promise.resolve();
    await Promise.resolve();

    expect(failures).toHaveLength(1);
  });
});
