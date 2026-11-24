import { describe, expect, it } from "vitest";
import {
  applySetup,
  type PlannedChange,
  type SetupApplyEvent,
  type SetupEntry,
} from "../../src/index.js";
import { changesFor, ManualStop, runWorldOf } from "./setup-run-world.js";
import { ROOT } from "./world.js";

function states(events: SetupApplyEvent[]): string[] {
  return events
    .filter((event) => event.event === "change" && event.state !== "running")
    .map((event) => (event.event === "change" ? `${event.state}` : ""));
}

describe("setup apply", () => {
  it("a failing step undoes the earlier ones byte for byte", async () => {
    const changes = changesFor();
    const failing = changes.findIndex((change) => change.id === "tests-engine");

    expect(failing).toBeGreaterThanOrEqual(3);

    const first = changes[failing]?.steps[0]?.argv.join(" ") ?? "?";
    const world = runWorldOf((argv) => argv.join(" ").startsWith(first));
    const before = world.fakes.setupFiles.snapshot();
    const events: SetupApplyEvent[] = [];
    const outcome = await applySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: (event) => events.push(event),
    });

    expect(outcome).toMatchObject({ status: "finished", ok: false });
    expect(world.fakes.setupFiles.snapshot()).toBe(before);
    expect(states(events)).toEqual([
      ...Array(failing).fill("done"),
      "failed",
      ...Array(failing).fill("undone"),
    ]);
    expect(events[events.length - 1]).toEqual({
      event: "result",
      ok: false,
      doctor: null,
    });
    expect(
      events.some(
        (event) =>
          event.event === "change" &&
          event.state === "undone" &&
          event.output.includes("node_modules"),
      ),
    ).toBe(true);
  });

  it("emits one command event pair per step and doctor events before the result", async () => {
    const world = runWorldOf();
    const changes = changesFor().filter((change) =>
      ["analysis-long_function", "tool-cargo-llvm-cov"].includes(change.id),
    );
    const total = changes.reduce((sum, change) => sum + change.steps.length, 0);
    const events: SetupApplyEvent[] = [];

    expect(changes).toHaveLength(2);

    await applySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: (event) => events.push(event),
    });

    expect(events[0]).toEqual({ event: "start", total: 2, commands: total });

    const commands = events.filter((event) => event.event === "command");

    expect(commands).toHaveLength(total * 2);

    for (const [index, change] of changes.entries()) {
      for (const [at, { argv }] of change.steps.entries()) {
        for (const state of ["running", "done"]) {
          expect(commands).toContainEqual({
            event: "command",
            index,
            step: at + 1,
            steps: change.steps.length,
            command: argv.join(" "),
            state,
          });
        }
      }
    }

    expect(
      events
        .map((event) =>
          event.event === "doctor" ? `doctor ${event.state}` : event.event,
        )
        .slice(-3),
    ).toEqual(["doctor running", "doctor done", "result"]);
  });

  it("a failing step emits command running and no done for it, then change failed", async () => {
    const changes = changesFor().filter((change) =>
      ["analysis-long_function", "tool-cargo-llvm-cov"].includes(change.id),
    );
    const failing = changes[1]?.steps[0]?.argv.join(" ") ?? "?";
    const world = runWorldOf((argv) => argv.join(" ").startsWith(failing));
    const events: SetupApplyEvent[] = [];

    await applySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: (event) => events.push(event),
    });

    expect(
      events.filter((event) => event.event === "command" && event.index === 1),
    ).toMatchObject([{ state: "running", step: 1 }]);
    expect(states(events)).toEqual(["done", "failed", "undone"]);
    expect(events.some((event) => event.event === "doctor")).toBe(false);
  });

  it("a step stopped by a signal undoes the earlier ones", async () => {
    const world = runWorldOf();
    const changes = changesFor();
    const before = world.fakes.setupFiles.snapshot();
    const original = world.fakes.programs.start.bind(world.fakes.programs);
    let count = 0;

    world.fakes.programs.start = (program, args, options) => {
      count += 1;

      return count === 4
        ? {
            result: Promise.resolve({
              started: true,
              status: 143,
              stdout: "",
              stderr: "",
              stopped: true,
            }),
            kill: () => {},
          }
        : original(program, args, options);
    };

    const events: SetupApplyEvent[] = [];
    const outcome = await applySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: (event) => events.push(event),
    });

    expect(outcome).toMatchObject({ status: "finished", ok: false });
    expect(world.fakes.setupFiles.snapshot()).toBe(before);
    expect(states(events)).toContain("failed");
    expect(
      states(events).filter((state) => state === "undone").length,
    ).toBeGreaterThan(0);
  });

  it("runs the undo a tool declares and only for a change that completed", async () => {
    const changes = changesFor();
    const cargoAt = changes.findIndex(
      (change) => change.id === "tool-cargo-llvm-cov",
    );
    const late = [
      ...changes.slice(cargoAt, cargoAt + 1),
      ...changes.filter((change) => change.id === "analysis-pair_min_lines"),
    ];
    const world = runWorldOf((argv) =>
      argv
        .join(" ")
        .startsWith("recognizer config sensors.structure.duplication"),
    );

    expect(cargoAt).toBeGreaterThanOrEqual(0);

    await applySetup(world.ports, {
      root: ROOT,
      changes: late,
      onEvent: () => {},
    });

    expect(world.uninstalled).toEqual(["cargo-llvm-cov"]);

    const second = runWorldOf((argv) =>
      argv
        .join(" ")
        .startsWith("recognizer config sensors.structure.duplication"),
    );
    const withoutInstall = changes.filter(
      (change) => !change.id.startsWith("tool-cargo"),
    );

    await applySetup(second.ports, {
      root: ROOT,
      changes: withoutInstall,
      onEvent: () => {},
    });

    expect(second.started.some((argv) => argv[0] === "cargo")).toBe(false);
    expect(second.uninstalled).toEqual([]);
  });

  it("restores the files a tool names to their bytes before the install", async () => {
    const all = changesFor();
    const tool = all.find((change) => change.id === "tool-@vitest/coverage-v8");
    const analysis = all.find(
      (change) => change.id === "analysis-pair_min_lines",
    );
    const changes = [tool, analysis].filter(
      (change): change is PlannedChange => change !== undefined,
    );
    const world = runWorldOf((argv) => argv[0] === "recognizer");
    const before = world.fakes.setupFiles.snapshot();

    expect(tool?.restores).toContain(`${ROOT}/package-lock.json`);

    await applySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: () => {},
    });

    expect(world.fakes.setupFiles.snapshot()).toBe(before);
  });

  it("a success reports each change as an entry and runs the doctor", async () => {
    const quiet = {
      analysis: { on: true, limits: { pair_min_lines: 12 } },
      policy: [
        {
          kind: "ignore" as const,
          globs: ["scripts/*"],
          why: "w",
          based_on: "b",
        },
      ],
    };
    const changes = changesFor(quiet);
    const world = runWorldOf();
    const events: SetupApplyEvent[] = [];
    const entries: SetupEntry[] = [];

    expect(changes).toHaveLength(2);

    const outcome = await applySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: (event) => events.push(event),
      onEntry: (entry) => entries.push(entry),
    });

    expect(outcome).toMatchObject({ status: "finished", ok: true });
    expect(states(events)).toEqual(["done", "done"]);
    expect(entries.map((entry) => entry.name)).toEqual([
      "analysis-pair_min_lines",
      "policy-1",
    ]);
    expect(entries.every((entry) => entry.reason === undefined)).toBe(true);
    expect(
      world.fakes.setupFiles.text(`${ROOT}/.recognizer/config.yaml`),
    ).toContain("pair_min_lines 12");
  });

  it("a failed change is an entry with its reason", async () => {
    const changes = changesFor().filter(
      (change) => change.id === "analysis-pair_min_lines",
    );
    const world = runWorldOf(() => true);
    const entries: SetupEntry[] = [];

    await applySetup(world.ports, {
      root: ROOT,
      changes,
      onEvent: () => {},
      onEntry: (entry) => entries.push(entry),
    });

    expect(entries).toMatchObject([
      {
        name: "analysis-pair_min_lines",
        status: 1,
        reason: "analysis-pair_min_lines failed",
      },
    ]);
  });

  it("is refused while a scan holds the repository", async () => {
    const world = runWorldOf();

    world.fakes.lock.acquire(ROOT, { sensors: [], describe: false });

    const outcome = await applySetup(world.ports, {
      root: ROOT,
      changes: changesFor(),
      onEvent: () => {},
    });

    expect(outcome).toEqual({
      status: "refused",
      reason: "a scan is already running",
    });
    expect(world.started).toEqual([]);
  });

  it("a stop request waits for the undo before it finishes", async () => {
    const world = runWorldOf();
    const changes = changesFor();
    const before = world.fakes.setupFiles.snapshot();
    const stop = new ManualStop();
    const events: SetupApplyEvent[] = [];
    let settledAtUndo = -1;

    world.fakes.programs.held.add("npm");

    const applied = applySetup(world.ports, {
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

    const outcome = await applied;

    expect(outcome).toMatchObject({ status: "finished", ok: false });
    expect(world.fakes.programs.killed).toBe(1);
    expect(settledAtUndo).toBe(0);
    expect(stop.settledCalls).toBe(1);
    expect(world.fakes.setupFiles.snapshot()).toBe(before);
    expect(states(events)).toContain("failed");
    expect(states(events)).toContain("undone");
  });
});
