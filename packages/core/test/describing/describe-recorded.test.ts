import { describe, expect, it } from "vitest";
import { describeRecorded } from "../../src/index.js";
import { DescribingWorld } from "./describing-world.js";

const BY = "ken";
const INVOCATION = ["describe", "--by", "ken"];

function recorded(world: DescribingWorld, ...ids: string[]) {
  const repository = world.repository(...ids);

  return (over: Parameters<DescribingWorld["request"]>[1] = {}) =>
    describeRecorded(world.ports, {
      ...world.request(repository, over),
      by: BY,
      invocation: INVOCATION,
    });
}

describe("describeRecorded", () => {
  it("opens one record, rewrites it per entry and finishes it ok", async () => {
    const world = new DescribingWorld();

    await recorded(world, "a", "b")();

    expect(world.runLog.describeRuns).toHaveLength(1);

    const [run] = world.runLog.describeRuns;

    expect(run.by).toBe(BY);
    expect(run.invocation).toEqual(INVOCATION);
    expect(run.startedAt).toBe(1000);
    expect(run.updates.map((entries) => entries.length)).toEqual([1, 2]);
    expect(run.entries.map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(run.finished).toBe(true);
    expect(run.crashed).toBe(false);
  });

  it("opens no record when nothing is selected or the confirmation is refused", async () => {
    const current = new DescribingWorld();

    current.line("a");
    current.line("b");

    expect(current.lines().ids()).not.toEqual([]);

    const none = await recorded(current, "a", "b")();

    expect(current.runLog.describeRuns).toEqual([]);
    expect(none.described).toEqual([]);

    const refused = new DescribingWorld();
    const result = await recorded(
      refused,
      "a",
      "b",
    )({
      confirm: async () => false,
    });

    expect(refused.runLog.describeRuns).toEqual([]);
    expect(result.described).toEqual([]);
  });

  it("finishes a describer failure as an entry, not a crash", async () => {
    const world = new DescribingWorld();

    world.describer.results.set("a", { status: 1, stdout: "" });
    await recorded(world, "a", "b")();

    const [run] = world.runLog.describeRuns;

    expect(run.crashed).toBe(false);
    expect(run.entries.map((entry) => [entry.name, entry.outcome])).toEqual([
      ["a", "failed"],
      ["b", "ok"],
    ]);
  });

  it("finishes a stopped describe as not crashed", async () => {
    const world = new DescribingWorld();

    world.describer.results.set("a", { status: 75, stdout: "" });

    const result = await recorded(world, "a", "b")();
    const [run] = world.runLog.describeRuns;

    expect(result.stopped?.cause).toBe("limit");
    expect(run.entries).toHaveLength(1);
    expect(run.crashed).toBe(false);
  });

  it("closes the record as crashed with the entries so far and rethrows when a callback throws after an entry", async () => {
    const world = new DescribingWorld();

    await expect(
      recorded(
        world,
        "a",
        "b",
      )({
        onEntry: () => {
          throw new Error("boom-entry");
        },
      }),
    ).rejects.toThrow("boom-entry");

    const [run] = world.runLog.describeRuns;

    expect(run.entries).toHaveLength(1);
    expect(run.crashed).toBe(true);
  });

  it("closes the record as crashed with no entries when onStart throws", async () => {
    const world = new DescribingWorld();

    await expect(
      recorded(
        world,
        "a",
        "b",
      )({
        onStart: () => {
          throw new Error("boom-start");
        },
      }),
    ).rejects.toThrow("boom-start");

    const [run] = world.runLog.describeRuns;

    expect(run.entries).toEqual([]);
    expect(run.finished).toBe(true);
    expect(run.crashed).toBe(true);
  });

  it("opens no record when a name is unknown", async () => {
    const world = new DescribingWorld();

    await expect(
      recorded(
        world,
        "a",
        "b",
      )({
        selection: { kind: "names", names: ["nope"] },
      }),
    ).rejects.toThrow();

    expect(world.runLog.describeRuns).toEqual([]);
  });

  it("a failing close never replaces the thrown error", async () => {
    const world = new DescribingWorld();

    world.runLog.failClose = true;

    await expect(
      recorded(
        world,
        "a",
        "b",
      )({
        onEntry: () => {
          throw new Error("boom-entry");
        },
      }),
    ).rejects.toThrow("boom-entry");
  });
});
