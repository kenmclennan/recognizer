import { describe, expect, it } from "vitest";
import { planSensors } from "../../src/application/sensing/plan-sensors.js";
import { runSensors } from "../../src/application/sensing/run-sensors.js";
import type {
  InstalledRead,
  PhaseRecorder,
  RunEntry,
  ScanSink,
  SensingPorts,
} from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { repositoryOf } from "../fakes/repository-of.js";

const REASON = "typo-manifest manifest could not be started";

const ALPHA = ["alpha", "run"];

const BETA = ["beta", "run"];

const SINK: ScanSink = {
  stopped: false,
  emit: () => {},
  say: () => {},
  human: () => {},
  flush: async () => {},
};

function installed(): InstalledRead {
  return {
    sensors: [],
    unreadable: [],
    registered: {
      [BETA.join("\0")]: {
        name: "beta",
        display: "Mine",
        runs_tests: true,
        scoped: false,
        placeholders: {},
        listed: true,
        metrics: [],
        findings: [],
        settings: [],
      },
    },
    registeredUnreadable: [{ name: "alpha", reason: REASON }],
  };
}

function planFor(suitesFile: string | undefined) {
  const ports = {
    config: { tests: () => [{ name: "unit" }] },
    files: {
      read: () => ({ ok: true, text: JSON.stringify({ alpha: ["unit"] }) }),
      absolute: (file: string) => file,
    },
  } as unknown as SensingPorts;

  return planSensors(ports, {
    selection: {
      selected: [
        { name: "alpha", command: ALPHA, manifest: ["typo-manifest"] },
        { name: "beta", command: BETA, manifest: ["beta", "manifest"] },
      ],
      installed: installed(),
    },
    sense: "all",
    config: null,
    suitesFile,
    modulesFile: undefined,
  });
}

describe("a sensor whose manifest command fails", () => {
  it("is_planned_as_broken_while_another_sensor_plans_normally", () => {
    const plan = planFor(undefined);

    expect(plan.selected.map((one) => [one.name, one.broken])).toEqual([
      ["alpha", { reason: REASON }],
      ["beta", undefined],
    ]);
    expect(plan.chosen).toEqual({ beta: ["unit"] });
  });

  it("does_not_make_a_suites_file_naming_it_fail_the_whole_plan", () => {
    const plan = planFor("suites.json");

    expect(plan.selected[0]?.broken).toEqual({ reason: REASON });
    expect(plan.selected[0]?.command).toEqual(ALPHA);
  });

  it("is_recorded_as_failed_with_the_reason_and_the_others_still_run", async () => {
    const fakes = createFakes();
    const entries: RunEntry[] = [];
    const recorder = {
      start: () => ({ duration_ms: 0 }),
      entry: (_phase: unknown, entry: RunEntry) => {
        entries.push(entry);
      },
    } as unknown as PhaseRecorder;

    fakes.sensors.installed.set("beta", {
      name: "beta",
      runsTests: false,
      held: false,
    });

    const ports = {
      sensors: fakes.sensors,
      clock: fakes.clock,
    } as unknown as SensingPorts;
    const plan = planFor(undefined);

    await runSensors(ports, {
      root: "/work/repository",
      selected: plan.selected,
      scope: undefined,
      commit: "c0ffee",
      runScope: { kind: "working-tree" },
      modified: false,
      repository: repositoryOf({}, []),
      limits: {} as never,
      sink: SINK,
      recorder,
    });

    expect(fakes.sensors.ran.map((one) => one.name)).toEqual(["beta"]);
    expect(
      entries
        .filter((one) => one.outcome === "failed")
        .map((one) => [one.name, one.reason]),
    ).toEqual([["alpha", REASON]]);
  });
});
