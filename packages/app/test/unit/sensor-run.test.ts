import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Repository, type ViolatedRule } from "@recognizer/core";
import { violationId } from "recognizer";
import { describe, expect, it } from "vitest";
import { loadScans } from "../../src/scan-loading";
import { senseRepository, withSensors } from "../../src/sensor-run";
import { fakeSensors } from "../../src/sensors-fake";
import {
  CURRENT,
  fixturePolicy,
  fixtureScan,
  secondSensorDocument,
  structureDocument,
} from "../fixtures";
import { repositoryFrom } from "./repository-from";
import { documentText } from "./sensor-findings-from";

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

const REPO = resolve(dirname(fileURLToPath(srcUrl)), "../../..");
const scans = [fixtureScan("check", "scan.json", CURRENT)];
const policy = fixturePolicy("check");

type Args = Parameters<typeof fakeSensors>;

function stored(
  files: Record<string, string> = {},
  second?: Args[1],
  third?: Args[2],
): ReturnType<typeof fakeSensors> {
  return fakeSensors(
    {
      structure: documentText(structureDocument("check", policy)),
      ...files,
    },
    second,
    third,
  );
}

function statusOf(run: { statuses: { name: string }[] }, name: string) {
  return run.statuses.find((status) => status.name === name);
}

describe("senseRepository", () => {
  it("reports not run when it is unticked and there is no stored file", async () => {
    const port = fakeSensors();
    const run = await senseRepository(
      scans,
      { policy, config: null, analysis: false },
      port,
    );

    expect(run.documents).toEqual([]);
    expect(statusOf(run, "structure")).toEqual({
      name: "structure",
      status: "not run",
    });
  });

  it("matches the violation and warning ids of fixtures/check/expected.json", async () => {
    const expected = JSON.parse(
      readFileSync(join(REPO, "fixtures/check/expected.json"), "utf8"),
    ) as {
      violations: { from: string; rule: ViolatedRule }[];
      warnings: { id: string; evidence: { modules?: string[] } }[];
    };
    const run = await senseRepository(
      scans,
      { policy, config: null },
      stored(),
    );
    const findings = run.documents[0]?.findings ?? [];
    const violations = findings
      .filter((record) => record.severity === "violation")
      .map((record) => record.id)
      .sort();
    const warnings = findings.filter((record) => record.severity === "warning");

    expect(violations).toEqual(
      expected.violations
        .map((one) => violationId({ file: one.from, rule: one.rule }))
        .sort(),
    );
    expect(warnings).toHaveLength(expected.warnings.length);
  });

  it("removes the structure file when the sensor is off", async () => {
    const port = fakeSensors({ structure: "{}" });
    const run = await senseRepository(
      scans,
      { policy, config: "sensors:\n  structure: off\n" },
      port,
    );

    expect(statusOf(run, "structure")).toEqual({
      name: "structure",
      status: "off",
    });
    expect(run.documents).toEqual([]);
  });

  it("keeps unknown files on the structure status", async () => {
    const unknownFiles = { languages: ["swift"], files: ["a.swift"] };
    const withUnknown = fakeSensors({
      structure: documentText({
        ...structureDocument("check", policy),
        unknownFiles,
      }),
    });
    const without = stored();
    const input = { policy, config: null };

    expect(
      statusOf(await senseRepository(scans, input, withUnknown), "structure"),
    ).toMatchObject({ unknownFiles });
    expect(
      statusOf(await senseRepository(scans, input, without), "structure"),
    ).not.toHaveProperty("unknownFiles");
  });

  it("an_unreadable_findings_file_is_shown_unreadable_and_kept", async () => {
    const port = fakeSensors({ lint: "{not json" });

    port.refused = ["evil"];

    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({ status: "failed" });
    expect(statusOf(run, "evil")).toMatchObject({ status: "failed" });
    expect(port.removed).toEqual([]);
    expect(port.files.has("lint")).toBe(true);
  });

  it("keeps a file from another commit and reports it ran, leaving staleness to the freshness answer", async () => {
    const stale = secondSensorDocument("shop/main.py", "x", "y", "old");
    const port = fakeSensors({ lint: documentText(stale) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({
      name: "lint",
      status: "ran",
      findings: 1,
      modifiedMs: null,
      commit: "old",
    });
    expect(run.documents.map((document) => document.sensor.name)).toContain(
      "lint",
    );
    expect(port.removed).toEqual([]);
  });

  it("lists a registered sensor with no file as not run, never failed", async () => {
    const run = await senseRepository(
      scans,
      {
        policy,
        config:
          "sensors:\n  coverage:\n    command: [coverage-sensor, '{repository}']\n",
      },
      stored(),
    );

    expect(statusOf(run, "coverage")).toEqual({
      name: "coverage",
      status: "not run",
    });
  });

  it("shows ran, failed and not run together", async () => {
    const stale = secondSensorDocument("shop/main.py", "x", "y", "old");
    const port = stored({
      lint: documentText(stale),
      broken: "[]",
    });
    const run = await senseRepository(
      scans,
      {
        policy,
        config:
          "sensors:\n  coverage:\n    command: [coverage-sensor, '{repository}']\n",
      },
      port,
    );

    expect(run.statuses.map((status) => [status.name, status.status])).toEqual([
      ["structure", "ran"],
      ["lint", "ran"],
      ["broken", "failed"],
      ["coverage", "not run"],
    ]);
  });

  it("carries a findings document's stopped and partial keys onto its status", async () => {
    const document = {
      ...secondSensorDocument("shop/main.py"),
      stopped: { measured: 1, total: 3 },
      partial: { measured: 1, total: 3 },
    };
    const port = fakeSensors({ lint: documentText(document) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({
      stopped: { measured: 1, total: 3 },
      partial: { measured: 1, total: 3 },
    });
  });

  it("carries a findings document's excluded key onto its status", async () => {
    const document = {
      ...secondSensorDocument("shop/main.py"),
      excluded: { functions: 2, files: ["shop/main.py"] },
    };
    const port = fakeSensors({ lint: documentText(document) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({
      excluded: { functions: 2, files: ["shop/main.py"] },
    });
  });

  it("carries a findings document's unowned key onto its status", async () => {
    const document = {
      ...secondSensorDocument("shop/main.py"),
      unowned: { functions: 2, files: ["shop/main.py"] },
    };
    const port = fakeSensors({ lint: documentText(document) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({
      unowned: { functions: 2, files: ["shop/main.py"] },
    });
  });

  it("reads a current file from a second sensor", async () => {
    const document = secondSensorDocument("shop/main.py");
    const port = stored({ lint: documentText(document) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({
      name: "lint",
      status: "ran",
      findings: 1,
      modifiedMs: null,
      commit: "abc1234",
      measured: { inputs: expect.any(Object) },
    });
    expect(run.documents.map((one) => one.sensor.name)).toEqual([
      "structure",
      "lint",
    ]);
  });

  it("names an invalid config and runs the structure sensor on defaults", async () => {
    const run = await senseRepository(
      scans,
      { policy, config: "sensors: [" },
      stored(),
    );

    expect(statusOf(run, "config.yaml")).toMatchObject({ status: "failed" });
    expect(statusOf(run, "structure")).toMatchObject({ status: "ran" });
  });

  it("falls back without a policy when the policy uses a retired key", async () => {
    const run = await senseRepository(
      scans,
      {
        policy: "components:\n  one: shop/**\n",
        config: null,
      },
      stored(),
    );

    expect(statusOf(run, "policy.yaml")).toMatchObject({ status: "failed" });
    expect(statusOf(run, "structure")).toMatchObject({ status: "ran" });
  });
});

describe("senseRepository and reports", () => {
  const reported = (name: string, commit: string) =>
    documentText({
      ...secondSensorDocument("shop/main.py", "x", "y", commit),
      sensor: { name, version: "reported" },
      reportedAt: "2026-11-02T10:00:00.000Z",
    });

  it("marks a document with reported_at as reported and keeps ran or stale", async () => {
    const port = fakeSensors({
      review: reported("review", CURRENT),
      older: reported("older", "old1234567"),
    });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "review")).toMatchObject({
      name: "review",
      status: "ran",
      findings: 1,
      modifiedMs: null,
      commit: CURRENT,
      reported: { at: "2026-11-02T10:00:00.000Z", commit: CURRENT },
    });
    expect(statusOf(run, "older")).toMatchObject({
      status: "ran",
      reported: { commit: "old1234567" },
    });
    expect(run.documents.map((one) => one.sensor.name)).toContain("review");
  });

  it("leaves a registered name carrying the mark unmarked and an unmarked file unmarked", async () => {
    const port = fakeSensors({
      lint: reported("lint", CURRENT),
      plain: documentText({
        ...secondSensorDocument("shop/main.py"),
        sensor: { name: "plain", version: "1" },
      }),
    });
    const run = await senseRepository(
      scans,
      { policy, config: "sensors:\n  lint:\n    command: [lint]\n" },
      port,
    );

    expect(statusOf(run, "lint")).not.toHaveProperty("reported");
    expect(statusOf(run, "plain")).not.toHaveProperty("reported");
  });
});

describe("withSensors tests hash", () => {
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

  it("stores the hash the port reads, handing it no known hashes so tests are hashed from disk", async () => {
    const port = stored();
    const seen: Record<string, string>[] = [];

    port.testsHash = "a".repeat(64);
    port.readTestsHash = async (known) => {
      seen.push(known);

      return port.testsHash;
    };

    const repository = repositoryFrom([
      {
        modules: [],
        edges: [],
        foreign: [],
        files: [{ path: "tests/a.py", hash: "h" }],
      },
    ]);
    const next = await withSensors(
      {
        ...empty,
        scans: [{ file: "scan.json", repository }],
        repository,
      },
      port,
    );

    expect(next.tests).toBe("a".repeat(64));
    expect(seen).toEqual([{}]);
  });

  it("is null when the port has none and when it throws", async () => {
    const none = await withSensors(empty, stored());
    const port = stored();

    port.readTestsHash = async () => {
      throw new Error("no git");
    };

    const failed = await withSensors(empty, port);

    expect(none.tests).toBeNull();
    expect(failed.tests).toBeNull();
  });
});

describe("withSensors", () => {
  it("carries the documents, statuses, policy and baseline on Loaded", async () => {
    const port = stored({}, { policy, baseline: "{}" });
    const loaded = {
      ...loadScans({
        status: "scanned",
        exitCode: 0,
        stderr: "",
        scans: [
          {
            file: "scan.python.json",
            text: JSON.stringify({ ...scans[0]?.document, commit: CURRENT }),
          },
        ],
        policy: null,
      }),
    };
    const next = await withSensors(loaded, port);

    expect(loaded.findings).toEqual([]);
    expect(next.findings.map((document) => document.sensor.name)).toEqual([
      "structure",
    ]);
    expect(next.sensors).toEqual([
      {
        name: "structure",
        status: "ran",
        commit: CURRENT,
        modified: false,
        modifiedMs: null,
        notMeasured: ["duplication", "complexity"],
      },
    ]);
    expect(next.policy).toBe(policy);
    expect(next.baseline).toBe("{}");
    expect(next.modules).toEqual(loaded.modules);
  });

  it("carries the overlay files and the names the read refused", async () => {
    const port = fakeSensors({}, {}, { crap: "{}", other: "{}" });

    port.overlaysRefused.push("evil");
    port.modifiedOverlays.set("crap", 1234);

    const next = await withSensors(
      {
        modules: [],
        scans: [],
        repository: Repository.empty,
        policy: null,
        baseline: null,
        notices: [],
        blocking: null,
        findings: [],
        sensors: [],
      },
      port,
    );

    expect(next.overlays).toEqual([
      { name: "crap", text: "{}", modifiedMs: 1234 },
      { name: "other", text: "{}", modifiedMs: null },
    ]);
    expect(next.overlaysUnreadable).toEqual(["evil"]);
  });
});
