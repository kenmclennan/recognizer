import {
  documentFreshness,
  measuredFiles,
  Repository,
  splitDocument,
  suiteStandings,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { fakeSensors } from "../../src/sensors-fake";
import {
  CURRENT,
  fixtureScan,
  installedSensors,
  secondSensorDocument,
} from "../fixtures";
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

describe("fakeSensors results split", () => {
  const document = secondSensorDocument("shop/main.py");
  const sensors = () => fakeSensors({ lint: documentText(document) });

  it("answers shown and hidden agreeing with splitDocument", async () => {
    const fake = sensors();
    const { repository } = fixtureScan("check", "scan.json", CURRENT);

    fake.structure = repository;

    const file = (await fake.readResults("t")).findings.files[0];
    const expected = splitDocument(repository, document, "t");

    expect(file?.shown).toEqual(expected.shown);
    expect(file?.hidden).toEqual(expected.hidden);
    expect((file?.shown?.length ?? 0) + (file?.hidden?.length ?? 0)).toBe(
      document.findings.length,
    );
  });

  it("answers measured agreeing with measuredFiles", async () => {
    const fake = sensors();
    const { repository } = fixtureScan("check", "scan.json", CURRENT);

    fake.structure = repository;

    const file = (await fake.readResults("t")).findings.files[0];
    const expected = measuredFiles(
      repository,
      null,
      "lint",
      documentFreshness(
        repository,
        {
          ...(document.inputs === undefined ? {} : { inputs: document.inputs }),
          ...(document.tests === undefined ? {} : { tests: document.tests }),
        },
        "t",
      ),
    );

    expect(file?.measured).toEqual(expected);
  });

  it("splits over the empty repository when the fake has no structure", async () => {
    const file = (await sensors().readResults()).findings.files[0];

    const expected = splitDocument(Repository.empty, document, null);

    expect(Object.hasOwn(file?.document ?? {}, "findings")).toBe(false);
    expect(file?.shown).toEqual(expected.shown);
    expect(file?.hidden).toEqual(expected.hidden);
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

describe("fakeSensors suite standings", () => {
  const withSuites = {
    ...secondSensorDocument("shop/main.py"),
    suites: [
      {
        name: "unit",
        status: "failed" as const,
        ranAt: "2026-11-12T10:00:00.000Z",
        reason: "boom",
      },
    ],
  };

  it("answers suites agreeing with suiteStandings, with or without a structure", async () => {
    const fake = fakeSensors({ lint: documentText(withSuites) });

    const bare = (await fake.readResults()).findings.files[0];

    expect(bare?.suites).toEqual(suiteStandings(withSuites.suites));
    expect(Object.hasOwn(bare?.document ?? {}, "suites")).toBe(false);
    expect(bare?.suites?.length).toBe(1);

    fake.structure = fixtureScan("check", "scan.json", CURRENT).repository;

    const held = (await fake.readResults("t")).findings.files[0];

    expect(held?.suites).toEqual(bare?.suites);
  });

  it("answers null for a document without suites", async () => {
    const file = (
      await fakeSensors({
        lint: documentText(secondSensorDocument("shop/main.py")),
      }).readResults()
    ).findings.files[0];

    expect(file?.suites).toBeNull();
  });
});
