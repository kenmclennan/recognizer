import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSensorRows, readShippedSensors } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { ConfigAdapter } from "../src/adapters/filesystem/config-adapter.js";
import { SensorCatalogAdapter } from "../src/adapters/plugins/sensor-catalog-adapter.js";
import type { Io, RunResult } from "../src/cli.js";
import { nodeIo } from "../src/cli.js";
import { shippedPorts } from "../src/manifest-ports.js";
import { REPO } from "./helpers.js";
import { requireSensorsVenv } from "./sensors-venv.js";

const io: Io = {
  ...nodeIo(),
  run: (command, args): RunResult => {
    const result = spawnSync(
      join(REPO, `packages/sensors/.venv/bin/${command}`),
      args,
      {
        encoding: "utf8",
      },
    );

    return {
      started: result.error === undefined,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};

describe("the committed sensor manifests", () => {
  requireSensorsVenv(REPO);

  const read = readShippedSensors(shippedPorts(io));
  const by = (name: string) => read.sensors.find((one) => one.name === name);
  const published = (sensor: string, metric: string) =>
    by(sensor)?.metrics.find((one) => one.name === metric)?.published?.value;

  it("reads the crap and mutation sensors", () => {
    expect(read.unreadable).toEqual([]);
    expect(read.sensors.map((one) => one.name)).toEqual(["crap", "mutation"]);
  });

  it("lists the sensors the committed list marks, in display order", () => {
    const committed = JSON.parse(
      readFileSync(join(REPO, "fixtures/sensors/shipped.json"), "utf8"),
    ) as string[];
    const rows = readSensorRows(
      {
        config: new ConfigAdapter(io, "all"),
        catalog: new SensorCatalogAdapter(io),
      },
      REPO,
    );

    expect(rows.map((row) => row.name).sort()).toEqual([...committed].sort());
    expect(rows.map((row) => row.display)).toEqual(
      rows.map((row) => row.display).sort((a, b) => a.localeCompare(b)),
    );
  });

  it("carries the flags the code used to hold", () => {
    expect(read.sensors.map((one) => one.listed)).toEqual([true, true]);
    expect(read.sensors.map((one) => one.runs_tests)).toEqual([true, true]);
    expect(read.sensors.map((one) => one.scoped)).toEqual([false, true]);
    expect(read.sensors.map((one) => one.metrics.length)).toEqual([3, 4]);
  });

  it("carries crap's threshold default and the published figures", () => {
    const settings = (by("crap")?.settings ?? []) as {
      key: string;
      default?: number;
    }[];
    const threshold = settings.find((one) => one.key === "threshold");

    expect(threshold?.default).toBe(30);
    expect(published("crap", "complexity")).toBe(10);
    expect(published("crap", "coverage")).toBe(0.6);
    expect(published("crap", "crap")).toBe(30);
  });
});
