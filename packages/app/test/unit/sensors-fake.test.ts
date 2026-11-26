import { describe, expect, it } from "vitest";
import { fakeSensors } from "../../src/sensors-fake";
import { installedSensors, secondSensorDocument } from "../fixtures";
import { documentText } from "./sensor-findings-from";

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
    });
  });

  it("records the model in the version of a configured describer that names {model}", async () => {
    const fake = fakeSensors(
      {},
      {
        config:
          "describer:\n  command: [d, '--model', '{model}', '{request}']\n  version: v9\n",
      },
    );

    expect(((await fake.describer()) as { version: string }).version).toBe(
      "v9",
    );
  });

  it("is unavailable when none is configured", async () => {
    const fake = fakeSensors();

    expect((await fake.describer()).status).toBe("unavailable");
  });

  it("carries a findings file's modification time", async () => {
    const fake = fakeSensors({
      lint: documentText(secondSensorDocument("shop/main.py")),
    });

    fake.modified.set("lint", 42);

    expect((await fake.readResults()).findings.files[0]?.modifiedMs).toBe(42);
  });
});

describe("the installed list a fake serves", () => {
  it("has entries that derive listed from their metrics and carry findings and settings arrays", async () => {
    const fake = fakeSensors({}, {}, {}, installedSensors());
    const list = await fake.sensorList();

    expect(list.status).toBe("ok");

    if (list.status !== "ok") {
      return;
    }

    expect(list.sensors.length).toBeGreaterThan(0);

    for (const entry of list.sensors) {
      expect(entry.listed).toBe(entry.metrics.length > 0);
      expect(Array.isArray(entry.findings)).toBe(true);
      expect(Array.isArray(entry.settings)).toBe(true);
      expect(Object.keys(entry)).not.toContain("defaults");
    }
  });
});
