import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Io, RunResult } from "../src/cli.js";
import { nodeIo } from "../src/cli.js";
import { readShippedSensors } from "../src/shipped-sensors.js";
import { REPO } from "./helpers.js";

const io: Io = {
  ...nodeIo(),
  run: (command, args): RunResult => {
    const result = spawnSync(join(REPO, `sensors/.venv/bin/${command}`), args, {
      encoding: "utf8",
    });

    return {
      started: result.error === undefined,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};

describe("the committed sensor manifests", () => {
  const read = readShippedSensors(io);
  const by = (name: string) => read.sensors.find((one) => one.name === name);
  const published = (sensor: string, metric: string) =>
    by(sensor)?.metrics.find((one) => one.name === metric)?.published?.value;

  it("reads all three sensors", () => {
    expect(read.unreadable).toEqual([]);
    expect(read.sensors.map((one) => one.name)).toEqual([
      "crap",
      "mutation",
      "thresholds",
    ]);
  });

  it("carries the flags the code used to hold", () => {
    expect(read.sensors.map((one) => one.listed)).toEqual([true, true, false]);
    expect(read.sensors.map((one) => one.runs_tests)).toEqual([
      true,
      true,
      false,
    ]);
    expect(read.sensors.map((one) => one.scoped)).toEqual([false, true, false]);
    expect(read.sensors.map((one) => one.metrics.length)).toEqual([3, 4, 0]);
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
