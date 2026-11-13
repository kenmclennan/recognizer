import { describe, expect, it } from "vitest";
import { fakeSensors } from "./sensors-fake";
import { shippedSensors } from "./shipped-fake";

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
      command: [
        "recognizer-describe-claude",
        "run",
        "--model",
        "{model}",
        "{request}",
      ],
      version: "prompt-0123456789ab",
      source: "shipped",
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

describe("fakeSensors readRunRecords", () => {
  it("returns names descending and surfaces the refused list, as the real command does", async () => {
    const fake = fakeSensors();

    fake.runRecords.set("20260101T000000001Z-scan.json", "a");
    fake.runRecords.set("20260101T000000003Z-sense.json", "c");
    fake.runRecords.set("20260101T000000002Z-scan.json", "b");
    fake.runRecordsRefused.push("20260101T000000009Z-scan.json");

    expect(await fake.readRunRecords()).toEqual({
      files: [
        { name: "20260101T000000003Z-sense.json", text: "c" },
        { name: "20260101T000000002Z-scan.json", text: "b" },
        { name: "20260101T000000001Z-scan.json", text: "a" },
      ],
      refused: ["20260101T000000009Z-scan.json"],
    });
  });
});

describe("the shipped list a fake serves", () => {
  it("has entries that derive listed from their metrics and carry findings and settings arrays", async () => {
    const fake = fakeSensors({}, {}, {}, shippedSensors());
    const list = await fake.shipped();

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
