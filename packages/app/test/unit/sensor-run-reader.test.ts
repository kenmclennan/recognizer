import { Repository, type SensorFindings } from "@recognizer/core";
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
  secondSensorDocument,
  structureDocument,
} from "../fixtures";
import { documentText, readFindingsText } from "./sensor-findings-from";

const scans = [fixtureScan("check", "scan.json", CURRENT)];
const policy = fixturePolicy("check");

function headerAndSplit(document: SensorFindings) {
  const { findings, ...header } = document;

  return { document: header, shown: [...findings], hidden: [] };
}

function readerOf(files: Record<string, string>) {
  return {
    readResults: async () => ({
      findings: {
        files: Object.entries(files).map(([name, text]) => ({
          name,
          ...headerAndSplit(readFindingsText(text, name)),
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
    split: {},
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

describe("withSensors over answered lists", () => {
  const record = (id: string) => ({ id }) as never;

  function listed(shown: string[], hidden: string[]) {
    const document = readFindingsText(
      documentText(secondSensorDocument("shop/main.py")),
      "lint",
    );
    const { findings: _records, ...header } = document;

    return {
      readResults: async () => ({
        findings: {
          files: [
            {
              name: "lint",
              document: header,
              modifiedMs: null,
              shown: shown.map(record),
              hidden: hidden.map(record),
            },
          ],
          refused: [],
        },
        overlays: { files: [], refused: [] },
        refusals: {},
        freshness: {},
        lastRun: null,
      }),
    };
  }

  it("keeps exactly the answered shown and hidden lists in the split", async () => {
    const loaded = await withSensors(
      {
        modules: [],
        scans: [],
        repository: Repository.empty,
        policy: null,
        baseline: null,
        notices: [],
        blocking: null,
        findings: [],
        split: {},
        sensors: [],
      },
      { ...inertSensors, ...listed(["a"], ["b"]) },
    );

    expect(loaded.split.lint).toEqual({
      shown: [record("a")],
      hidden: [record("b")],
    });
  });

  it("counts shown and hidden records as the status findings", async () => {
    const counted = async (shown: string[], hidden: string[]) =>
      (
        await senseRepository(scans, NO_INPUTS, listed(shown, hidden))
      ).statuses.find((status) => status.name === "lint")?.findings;

    expect(await counted(["a", "b"], ["c"])).toBe(3);
    expect(await counted([], [])).toBe(0);
  });
});
