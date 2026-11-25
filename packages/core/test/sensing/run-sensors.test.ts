import { describe, expect, it } from "vitest";
import { runSensors } from "../../src/application/sensing/run-sensors.js";
import type { PhaseRecorder, ScanSink, SensingPorts } from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { repositoryOf } from "../fakes/repository-of.js";

const SINK: ScanSink = {
  stopped: false,
  emit: () => {},
  say: () => {},
  human: () => {},
  flush: async () => {},
};

const RECORDER = {
  start: () => ({ duration_ms: 0 }),
  entry: () => {},
} as unknown as PhaseRecorder;

describe("sensing run-sensors", () => {
  it("passes_the_scope_to_the_sensors", async () => {
    const fakes = createFakes();

    fakes.sensors.installed.set("tally", {
      name: "tally",
      runsTests: false,
      held: false,
    });

    const ports = {
      sensors: fakes.sensors,
      clock: fakes.clock,
    } as unknown as SensingPorts;

    await runSensors(ports, {
      root: "/work/repository",
      selected: [
        {
          name: "tally",
          command: ["tally"],
          runsTests: false,
          scoped: false,
        },
      ],
      scope: undefined,
      commit: "c0ffee",
      runScope: { kind: "working-tree" },
      modified: false,
      repository: repositoryOf({}, []),
      limits: {} as never,
      sink: SINK,
      recorder: RECORDER,
    });

    expect(fakes.sensors.calls).toEqual([
      { scope: { kind: "working-tree" }, modified: false },
    ]);
  });
});
