import { Repository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  inertSensors,
  NO_INPUTS,
  senseRepository,
  withSensors,
} from "../../src/sensor-run";
import {
  CURRENT,
  fixturePolicy,
  fixtureScan,
  structureDocument,
} from "../fixtures";
import { documentText, readFindingsText } from "./sensor-findings-from";

const scans = [fixtureScan("check", "scan.json", CURRENT)];
const policy = fixturePolicy("check");

function readerOf(files: Record<string, string>) {
  return {
    readResults: async () => ({
      findings: {
        files: Object.entries(files).map(([name, text]) => ({
          name,
          document: readFindingsText(text, name),
          modifiedMs: null,
        })),
        refused: [],
      },
      overlays: { files: [], refused: [] },
      refusals: {},
      freshness: {},
      lastRun: null,
    }),
  };
}

function statusOf(run: { statuses: { name: string }[] }, name: string) {
  return run.statuses.find((status) => status.name === name);
}

describe("senseRepository over an unreadable config", () => {
  it("names an invalid config and runs the structure sensor on defaults", async () => {
    const run = await senseRepository(
      scans,
      { ...NO_INPUTS, configProblem: "sensors: [ is not valid" },
      readerOf({ structure: documentText(structureDocument("check", policy)) }),
    );

    expect(statusOf(run, "config.yaml")).toMatchObject({ status: "failed" });
    expect(statusOf(run, "structure")).toMatchObject({ status: "ran" });
  });
});

describe("withSensors tests hash without a listing", () => {
  const empty = {
    modules: [],
    scans: [],
    repository: Repository.empty,
    policy: null,
    baseline: null,
    notices: [],
    blocking: null,
    findings: [],
    sensors: [],
  };

  it("is null when the port has none and when it throws", async () => {
    const none = await withSensors(empty, inertSensors);
    const failed = await withSensors(empty, {
      ...inertSensors,
      readTestsHash: async () => {
        throw new Error("no git");
      },
    });

    expect(none.tests).toBeNull();
    expect(failed.tests).toBeNull();
  });
});
