import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFindings } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  CURRENT,
  fixturePolicy,
  fixtureScan,
  secondSensorDocument,
  structureDocument,
} from "./fixtures";
import { loadScans } from "./scan-loading";
import { senseRepository, withSensors } from "./sensor-run";
import { fakeSensors } from "./sensors-fake";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scans = [fixtureScan("check", "scan.json", CURRENT)];
const policy = fixturePolicy("check");

function statusOf(run: { statuses: { name: string }[] }, name: string) {
  return run.statuses.find((status) => status.name === name);
}

describe("senseRepository", () => {
  it("writes the structure file when the scans carry a commit", async () => {
    const port = fakeSensors();
    const run = await senseRepository(scans, { policy, config: null }, port);
    const text = port.written[0];

    expect(typeof text).toBe("string");
    expect(
      validateFindings(JSON.parse(text as string), { name: "structure" })
        .commit,
    ).toBe(CURRENT);
    expect(run.documents[0]?.commit).toBe(CURRENT);
  });

  it("carries the stored duplication findings through a rewrite of the structure file", async () => {
    const first = await senseRepository(
      scans,
      { policy, config: null },
      fakeSensors(),
    );
    const settings = {
      threshold: 0.82,
      min_lines: 4,
      pair_min_lines: 6,
      min_nodes: 20,
    };
    const kept = {
      ...first.documents[0],
      settings: { ...first.documents[0]?.settings, duplication: settings },
      findings: [
        ...(first.documents[0]?.findings ?? []),
        {
          id: "duplication:a.py::f|a.py::g",
          kind: "duplication",
          severity: "warning",
          principle: "dont-repeat-yourself",
          summary: "f in a.py is 90% similar to g in a.py",
          evidence: { modules: ["a.py"] },
        },
      ],
    };
    const port = fakeSensors({ structure: JSON.stringify(kept) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(
      run.documents[0]?.findings.filter((one) => one.kind === "duplication"),
    ).toHaveLength(1);
    expect(statusOf(run, "structure")).toEqual({
      name: "structure",
      status: "ran",
    });
  });

  it("reports duplication as not measured when the stored document does not match", async () => {
    const run = await senseRepository(
      scans,
      { policy, config: null },
      fakeSensors(),
    );

    expect(statusOf(run, "structure")).toEqual({
      name: "structure",
      status: "ran",
      notMeasured: ["duplication"],
    });
  });

  it("keeps the structure document in memory when the scans carry no commit", async () => {
    const port = fakeSensors();
    const bare = [fixtureScan("check")];
    const run = await senseRepository(bare, { policy, config: null }, port);

    expect(port.written).toEqual([null]);
    expect(run.documents[0]?.commit).toBe("");
    expect(statusOf(run, "structure")).toMatchObject({ status: "ran" });
  });

  it("matches the violation and warning ids of fixtures/check/expected.json", async () => {
    const expected = JSON.parse(
      readFileSync(join(REPO, "fixtures/check/expected.json"), "utf8"),
    ) as {
      violations: { from: string; to: string; kind: string }[];
      warnings: { id: string; evidence: { modules?: string[] } }[];
    };
    const run = await senseRepository(
      scans,
      { policy, config: null },
      fakeSensors(),
    );
    const findings = run.documents[0]?.findings ?? [];
    const violations = findings
      .filter((record) => record.severity === "violation")
      .map((record) => record.id)
      .sort();
    const warnings = findings.filter((record) => record.severity === "warning");

    expect(violations).toEqual(
      expected.violations
        .map(({ from, to, kind }) => `rule-violation:${kind}:${from}->${to}`)
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

    expect(port.written).toEqual([null]);
    expect(statusOf(run, "structure")).toEqual({
      name: "structure",
      status: "off",
    });
    expect(run.documents).toEqual([]);
  });

  it("reports an invalid file as failed, by name, and removes it", async () => {
    const port = fakeSensors({ lint: "{not json" });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({ status: "failed" });
    expect(port.removed).toEqual(["lint"]);
  });

  it("reports a file the port refused as failed and removes it", async () => {
    const port = fakeSensors();

    port.refused = ["evil"];

    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "evil")).toMatchObject({ status: "failed" });
    expect(port.removed).toEqual(["evil"]);
  });

  it("keeps a file from another commit and reports it ran, leaving staleness to the freshness answer", async () => {
    const stale = secondSensorDocument("shop/main.py", "x", "y", "old");
    const port = fakeSensors({ lint: JSON.stringify(stale) });
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
      fakeSensors(),
    );

    expect(statusOf(run, "coverage")).toEqual({
      name: "coverage",
      status: "not run",
    });
  });

  it("shows ran, failed and not run together", async () => {
    const stale = secondSensorDocument("shop/main.py", "x", "y", "old");
    const port = fakeSensors({
      lint: JSON.stringify(stale),
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
    const port = fakeSensors({ lint: JSON.stringify(document) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({
      stopped: { measured: 1, total: 3 },
      partial: { measured: 1, total: 3 },
    });
  });

  it("carries a findings document's excluded key onto its status", async () => {
    const document = {
      ...secondSensorDocument("shop/main.py"),
      excluded: { functions: 2, modules: ["shop/main.py"] },
    };
    const port = fakeSensors({ lint: JSON.stringify(document) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({
      excluded: { functions: 2, modules: ["shop/main.py"] },
    });
  });

  it("carries a findings document's unowned key onto its status", async () => {
    const document = {
      ...secondSensorDocument("shop/main.py"),
      unowned: { functions: 2, modules: ["shop/main.py"] },
    };
    const port = fakeSensors({ lint: JSON.stringify(document) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toMatchObject({
      unowned: { functions: 2, modules: ["shop/main.py"] },
    });
  });

  it("reads a current file from a second sensor", async () => {
    const document = secondSensorDocument("shop/main.py");
    const port = fakeSensors({ lint: JSON.stringify(document) });
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
      fakeSensors(),
    );

    expect(statusOf(run, "config.yaml")).toMatchObject({ status: "failed" });
    expect(statusOf(run, "structure")).toMatchObject({ status: "ran" });
  });

  it("names an invalid policy and runs the structure sensor without one", async () => {
    const run = await senseRepository(
      scans,
      { policy: "levels: [", config: null },
      fakeSensors(),
    );

    expect(statusOf(run, "policy.yaml")).toMatchObject({ status: "failed" });
    expect(
      run.documents[0]?.findings.some((r) => r.severity === "violation"),
    ).toBe(false);
  });

  it("falls back without a policy when a module matches two components", async () => {
    const run = await senseRepository(
      scans,
      {
        policy:
          "components:\n  one: shop/**\n  two: shop/domain/**\nlevels: [one, two]\n",
        config: null,
      },
      fakeSensors(),
    );

    expect(statusOf(run, "policy.yaml")).toMatchObject({ status: "failed" });
    expect(statusOf(run, "structure")).toMatchObject({ status: "ran" });
  });

  it("names a structure file the port could not write as failed", async () => {
    const port = fakeSensors();

    port.failWrite = true;

    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "structure")).toMatchObject({ status: "failed" });
    expect(run.documents).toEqual([]);
  });

  it("is the same document the fixtures helper builds", async () => {
    const run = await senseRepository(
      scans,
      { policy, config: null },
      fakeSensors(),
    );

    expect(run.documents[0]).toEqual(structureDocument("check", policy));
  });
});

describe("senseRepository and reports", () => {
  const reported = (name: string, commit: string) =>
    JSON.stringify({
      ...secondSensorDocument("shop/main.py", "x", "y", commit),
      sensor: { name, version: "reported" },
      reported_at: "2026-11-02T10:00:00.000Z",
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
      plain: JSON.stringify({
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
    policy: null,
    baseline: null,
    notices: [],
    blocking: null,
    findings: [],
    sensors: [],
  };

  it("stores the hash the port reads, handing it the scans' file hashes", async () => {
    const port = fakeSensors();
    const seen: Record<string, string>[] = [];

    port.testsHash = "a".repeat(64);
    port.readTestsHash = async (known) => {
      seen.push(known);

      return port.testsHash;
    };

    const next = await withSensors(
      {
        ...empty,
        scans: [
          {
            file: "scan.json",
            scan: {
              modules: [],
              edges: [],
              foreign: [],
              files: [{ path: "tests/a.py", hash: "h" }],
            } as never,
          },
        ],
      },
      port,
    );

    expect(next.tests).toBe("a".repeat(64));
    expect(seen).toEqual([{ "tests/a.py": "h" }]);
  });

  it("is null when the port has none and when it throws", async () => {
    const none = await withSensors(empty, fakeSensors());
    const port = fakeSensors();

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
    const port = fakeSensors({}, { policy, baseline: "{}" });
    const loaded = {
      ...loadScans({
        status: "scanned",
        exitCode: 0,
        stderr: "",
        scans: [
          {
            file: "scan.python.json",
            text: JSON.stringify({ ...scans[0]?.scan, commit: CURRENT }),
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
      { name: "structure", status: "ran", notMeasured: ["duplication"] },
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
