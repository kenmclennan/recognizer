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

  it("keeps a file from another commit and lists it as stale", async () => {
    const stale = secondSensorDocument("shop/main.py", "x", "y", "old");
    const port = fakeSensors({ lint: JSON.stringify(stale) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toEqual({ name: "lint", status: "stale" });
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

  it("shows ran, stale, failed and not run together", async () => {
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
      ["lint", "stale"],
      ["broken", "failed"],
      ["coverage", "not run"],
    ]);
  });

  it("reads a current file from a second sensor", async () => {
    const document = secondSensorDocument("shop/main.py");
    const port = fakeSensors({ lint: JSON.stringify(document) });
    const run = await senseRepository(scans, { policy, config: null }, port);

    expect(statusOf(run, "lint")).toEqual({ name: "lint", status: "ran" });
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
    expect(next.sensors).toEqual([{ name: "structure", status: "ran" }]);
    expect(next.policy).toBe(policy);
    expect(next.baseline).toBe("{}");
    expect(next.modules).toEqual(loaded.modules);
  });
});

describe("fakeSensors.run", () => {
  const config = `sensors:
  alpha:
    command: [node, "{repository}/a.mjs", "{commit}", "{output}"]
`;

  it("writes a file the next senseRepository reads as ran", async () => {
    const port = fakeSensors({}, { config });
    port.commit = CURRENT;

    const result = await port.run(["alpha"]);
    const run = await senseRepository(scans, { policy, config }, port);

    expect(result).toEqual({
      status: "sensed",
      sensors: [{ name: "alpha", status: "ran" }],
    });
    expect(port.ran).toEqual([["alpha"]]);
    expect(statusOf(run, "alpha")).toMatchObject({ status: "ran" });
  });

  it("removes the file on a failing plan so the status reads not run", async () => {
    const port = fakeSensors({}, { config });
    port.commit = CURRENT;
    await port.run(["alpha"]);
    port.plan = { alpha: "it broke" };

    const result = await port.run(["alpha"]);
    const run = await senseRepository(scans, { policy, config }, port);

    expect(result).toEqual({
      status: "sensed",
      sensors: [{ name: "alpha", status: "failed", reason: "it broke" }],
    });
    expect(statusOf(run, "alpha")).toMatchObject({ status: "not run" });
  });

  it("rejects an empty list and a name the config does not register", async () => {
    const port = fakeSensors({}, { config });

    expect(await port.run([])).toMatchObject({ status: "failed" });
    expect(await port.run(["nope"])).toMatchObject({ status: "failed" });
  });
});
