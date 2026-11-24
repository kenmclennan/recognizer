import { describe, expect, it } from "vitest";
import {
  buildChanges,
  rehearsalChanges,
  type TryEvent,
  trySetup,
} from "../../src/index.js";
import {
  changesFor,
  choices,
  ManualStop,
  runWorldOf,
  surveyOf,
} from "./setup-run-world.js";
import { ROOT } from "./world.js";

function kept() {
  const survey = surveyOf();

  return rehearsalChanges(
    survey,
    buildChanges(survey, choices, "claude").changes,
  );
}

function runners(events: TryEvent[]) {
  return events.filter((event) => event.event === "runner");
}

function states(events: TryEvent[]): string[] {
  return events.flatMap((event) =>
    event.event === "change" && event.state !== "running" ? [event.state] : [],
  );
}

const GAP = { code: "x", suite: "tauri", line: "tauri has no coverage" };

describe("setup try", () => {
  it("a passing try leaves the repository byte-identical", async () => {
    const world = runWorldOf();
    const changes = kept();
    const before = world.fakes.setupFiles.snapshot();
    const events: TryEvent[] = [];

    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.every((change) => !change.id.startsWith("policy"))).toBe(
      true,
    );

    const outcome = await trySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: (event) => events.push(event),
    });

    expect(outcome).toMatchObject({ status: "finished", ok: true });
    expect(world.insideCheck).toHaveLength(1);
    expect(world.insideCheck[0]).not.toBe(before);
    expect(world.fakes.setupFiles.snapshot()).toBe(before);
    expect(events[events.length - 1]).toEqual({ event: "result", ok: true });
  });

  it("a failing try leaves the repository byte-identical", async () => {
    const world = runWorldOf(null, {
      ready: false,
      sensors: [{ name: "crap", ready: false, gaps: [GAP] }],
    });
    const before = world.fakes.setupFiles.snapshot();
    const events: TryEvent[] = [];
    const outcome = await trySetup(world.ports, {
      root: ROOT,
      changes: kept(),
      onEvent: (event) => events.push(event),
    });

    expect(outcome).toMatchObject({ status: "finished", ok: false });
    expect(world.insideCheck[0]).not.toBe(before);
    expect(world.fakes.setupFiles.snapshot()).toBe(before);
    expect(events[events.length - 1]).toEqual({ event: "result", ok: false });
  });

  it("a failing step undoes the earlier ones and emits no runner events", async () => {
    const changes = kept();
    const second = changes[1]?.steps[0]?.argv.join(" ") ?? "?";
    const world = runWorldOf((argv) => argv.join(" ").startsWith(second));
    const before = world.fakes.setupFiles.snapshot();
    const events: TryEvent[] = [];
    const outcome = await trySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: (event) => events.push(event),
    });

    expect(outcome).toMatchObject({ ok: false });
    expect(states(events)).toEqual(["done", "failed", "undone"]);
    expect(runners(events)).toEqual([]);
    expect(world.insideCheck).toEqual([]);
    expect(world.fakes.setupFiles.snapshot()).toBe(before);
  });

  it("a mixed result names each runner with its readiness", async () => {
    const world = runWorldOf(null, {
      ready: false,
      sensors: [{ name: "crap", ready: false, gaps: [GAP] }],
    });
    const events: TryEvent[] = [];

    await trySetup(world.ports, {
      root: ROOT,
      changes: kept(),
      onEvent: (event) => events.push(event),
    });

    expect(runners(events)).toEqual([
      { event: "runner", name: "engine", ready: true, detail: "", output: "" },
      {
        event: "runner",
        name: "tauri",
        ready: false,
        detail: "tauri has no coverage",
        output: "",
      },
    ]);
  });

  it("a gap line two sensors report for one suite shows once", async () => {
    const world = runWorldOf(null, {
      ready: false,
      sensors: [
        { name: "crap", ready: false, gaps: [GAP] },
        { name: "mutation", ready: false, gaps: [GAP] },
      ],
    });
    const events: TryEvent[] = [];

    await trySetup(world.ports, {
      root: ROOT,
      changes: kept(),
      onEvent: (event) => events.push(event),
    });

    expect(runners(events).find((one) => one.name === "tauri")).toMatchObject({
      detail: "tauri has no coverage",
    });
  });

  it("joins the distinct outputs of a runner's gaps with a blank line", async () => {
    const world = runWorldOf(null, {
      ready: false,
      sensors: [
        {
          name: "crap",
          ready: false,
          gaps: [
            { ...GAP, output: "first" },
            { ...GAP, line: "second line", output: "second" },
            { ...GAP, line: "third line", output: "first" },
          ],
        },
      ],
    });
    const events: TryEvent[] = [];

    await trySetup(world.ports, {
      root: ROOT,
      changes: kept(),
      onEvent: (event) => events.push(event),
    });

    expect(runners(events).find((one) => one.name === "tauri")).toMatchObject({
      output: "first\n\nsecond",
    });
  });

  it("a stopped try restores the repository", async () => {
    const world = runWorldOf();
    const changes = kept();
    const before = world.fakes.setupFiles.snapshot();
    const stop = new ManualStop();
    const events: TryEvent[] = [];
    let settledAtUndo = -1;

    world.fakes.programs.held.add("npm");

    const tried = trySetup(world.ports, {
      root: ROOT,
      changes,
      stop,
      onEvent: (event) => {
        events.push(event);

        if (event.event === "change" && event.state === "undone") {
          settledAtUndo = stop.settledCalls;
        }
      },
    });

    while (world.fakes.programs.pending.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    stop.request();

    const outcome = await tried;

    expect(outcome).toMatchObject({ status: "finished", ok: false });
    expect(settledAtUndo).toBe(0);
    expect(stop.settledCalls).toBe(1);
    expect(world.fakes.setupFiles.snapshot()).toBe(before);
    expect(states(events)).toContain("failed");
  });

  it("a try writes no setup run log", async () => {
    const world = runWorldOf();

    await trySetup(world.ports, {
      root: ROOT,
      changes: kept(),
      onEvent: () => {},
    });

    expect(world.fakes.runLog.runLogs).toEqual([]);
  });

  it("a try registers the chosen check for the check and restores the config", async () => {
    const world = runWorldOf();
    const survey = surveyOf();
    const changes = rehearsalChanges(
      survey,
      buildChanges(survey, { plugins: ["crap"] }, "claude").changes,
    );
    const before = world.fakes.setupFiles.snapshot();

    expect(changes.map((change) => change.id)).toEqual(["plugin-crap"]);

    await trySetup(world.ports, { root: ROOT, changes, onEvent: () => {} });

    expect(world.started[0]).toEqual(["recognizer", "plugin", "add", "crap"]);
    expect(world.insideCheck[0]).toContain("plugin add crap");
    expect(world.fakes.setupFiles.snapshot()).toBe(before);
  });

  it("is refused while a scan holds the repository", async () => {
    const world = runWorldOf();

    world.fakes.lock.acquire(ROOT, { sensors: [], describe: false });

    expect(
      await trySetup(world.ports, {
        root: ROOT,
        changes: changesFor(),
        onEvent: () => {},
      }),
    ).toEqual({ status: "refused", reason: "a scan is already running" });
  });
});
