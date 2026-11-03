import { describe, expect, it } from "vitest";
import { fakeSensors } from "./sensors-fake";

describe("fakeSensors describer", () => {
  it("returns the config's describer when it has one", async () => {
    const fake = fakeSensors(
      {},
      { config: "describer:\n  command: [d, '{request}']\n  version: v9\n" },
    );

    expect(await fake.describer()).toEqual({
      status: "ok",
      command: ["d", "{request}"],
      version: "v9",
      source: "config",
    });
  });

  it("falls back to the shipped describer when the config has none", async () => {
    expect(await fakeSensors().describer()).toEqual({
      status: "ok",
      command: ["recognizer-describe-claude", "{request}"],
      version: "prompt-0123456789ab",
      source: "shipped",
    });
  });

  it("is unavailable when none is configured and the shipped one is not installed", async () => {
    const fake = fakeSensors();

    fake.shippedVersion = null;

    expect((await fake.describer()).status).toBe("unavailable");
  });

  it("carries a findings file's modification time", async () => {
    const fake = fakeSensors({ lint: "{}" });

    fake.modified.set("lint", 42);

    expect((await fake.readFindings()).files[0]?.modifiedMs).toBe(42);
  });
});
