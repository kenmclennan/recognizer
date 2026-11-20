import { describe, expect, it } from "vitest";
import { poolScale, poolTestOptions, scaledTimeout } from "./pool-scale.mjs";

describe("poolScale", () => {
  it("leaves workers and timeouts undefined when LC_MAX_AGENTS is unset", () => {
    expect(poolScale({}, 8)).toEqual({
      maxWorkers: undefined,
      testTimeout: undefined,
      hookTimeout: undefined,
      multiplier: 1,
    });
  });

  it("ignores a non-numeric or non-positive LC_MAX_AGENTS", () => {
    expect(poolScale({ LC_MAX_AGENTS: "many" }, 8).multiplier).toBe(1);
    expect(poolScale({ LC_MAX_AGENTS: "0" }, 8).multiplier).toBe(1);
  });

  it("gives 2 workers and 3x timeouts for 4 agents on 8 cores", () => {
    expect(poolScale({ LC_MAX_AGENTS: "4" }, 8)).toEqual({
      maxWorkers: 2,
      testTimeout: 15000,
      hookTimeout: 30000,
      multiplier: 3,
    });
  });

  it("never gives fewer than one worker", () => {
    expect(poolScale({ LC_MAX_AGENTS: "32" }, 8).maxWorkers).toBe(1);
  });
});

describe("scaledTimeout", () => {
  it("keeps a timeout unchanged without LC_MAX_AGENTS", () => {
    expect(scaledTimeout(120000, {})).toBe(120000);
  });

  it("triples a timeout under the pool", () => {
    expect(scaledTimeout(120000, { LC_MAX_AGENTS: "4" })).toBe(360000);
  });
});

describe("poolTestOptions", () => {
  it("returns the base options untouched without LC_MAX_AGENTS", () => {
    expect(poolTestOptions({ environment: "node" }, {})).toEqual({
      environment: "node",
    });
  });

  it("keeps a configured test timeout and triples it under the pool", () => {
    const options = poolTestOptions(
      { testTimeout: 30000 },
      { LC_MAX_AGENTS: "1" },
    );

    expect(options.testTimeout).toBe(90000);
    expect(options.hookTimeout).toBe(30000);
  });
});
