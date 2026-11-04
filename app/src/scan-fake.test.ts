import { describe, expect, it } from "vitest";
import { fakeScan } from "./scan-fake";

const PLAN = { describe: true, measure: [], sense: ["alpha"] };

describe("fakeScan", () => {
  it("delivers the scripted lines in order before the run resolves", async () => {
    const fake = fakeScan({ steps: ["one", "two"] });
    const lines: string[] = [];

    fake.onLine((line) => lines.push(line));

    const result = await fake.run(PLAN);

    expect(lines).toEqual(["one", "two"]);
    expect(result).toEqual({
      status: "finished",
      exitCode: 0,
      stderr: "",
      log: null,
    });
    expect(fake.ran).toEqual([PLAN]);
  });

  it("refuses a second run while one is pending", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = fakeScan({ steps: [gate] });
    const first = fake.run(PLAN);
    const second = await fake.run(PLAN);

    expect(second).toEqual({
      status: "refused",
      reason: "a scan is already running",
    });

    release();
    await first;
  });

  it("stops the pending run and delivers no further lines", async () => {
    const gate = new Promise<void>(() => {});
    const fake = fakeScan({ steps: ["one", gate, "two"] });
    const lines: string[] = [];

    fake.onLine((line) => lines.push(line));

    const pending = fake.run(PLAN);

    await fake.stop();

    expect(await pending).toEqual({ status: "stopped" });
    expect(lines).toEqual(["one"]);
    expect(fake.stopped).toBe(1);
  });

  it("reads nothing ticked as not remembered until ticks are written", async () => {
    const fake = fakeScan();

    expect(await fake.readTicks()).toEqual({
      describe: false,
      sensors: false,
      ticked: [],
      remembered: false,
    });

    await fake.writeTicks({
      describe: false,
      ticked: ["alpha"],
    });

    expect(await fake.readTicks()).toEqual({
      describe: false,
      sensors: true,
      ticked: ["alpha"],
      remembered: true,
    });
  });
});
