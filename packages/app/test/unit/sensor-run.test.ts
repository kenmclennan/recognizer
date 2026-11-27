import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViolatedRule } from "@recognizer/core";
import { parsePolicy, violationId } from "recognizer";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { NO_CHANGES } from "../../src/footer-scan";
import type { ResponsibilityState } from "../../src/responsibility-model";
import {
  NO_RUN,
  type PanelInput,
  scanPanel as scanPanelAsked,
} from "../../src/scan-panel-model";
import type { SensorStatus } from "../../src/sensor-run";
import { untilHolds } from "../app-harness";
import {
  CURRENT,
  fixturePolicy,
  secondSensorDocument,
  structureDocument,
} from "../fixtures";
import { inProcessAppRoot } from "../in-process-root";
import { documentText } from "./sensor-findings-from";

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

const REPO = resolve(dirname(fileURLToPath(srcUrl)), "../../..");
const policy = fixturePolicy("check");
const TIMEOUT = scaledTimeout(60000);

type Root = Awaited<ReturnType<typeof inProcessAppRoot>>;

const findingsAt = (name: string) => `.recognizer/cache/findings/${name}.json`;
const overlayAt = (name: string) => `.recognizer/cache/overlays/${name}.json`;
const POLICY_AT = ".recognizer/policy.yaml";

async function awaitLoaded(root: Root) {
  return untilHolds(root.service, () => root.view.loaded() ?? undefined);
}

async function statusesOf(root: Root): Promise<SensorStatus[]> {
  return (await awaitLoaded(root)).sensors ?? [];
}

function statusOf(statuses: SensorStatus[], name: string) {
  return statuses.find((status) => status.name === name);
}

const EMPTY_OVERLAY = JSON.stringify({
  overlay_version: 1,
  inputs: {},
  commit: "0123456789abcdef0123456789abcdef01234567",
  modified: false,
  producer: { name: "crap", version: "0.1.0" },
  metrics: [],
  values: {},
});

const COVERAGE =
  "sensors:\n  coverage:\n    command: [coverage-sensor, '{repository}']\n    manifest: [coverage-sensor, manifest]\n";

describe("senseRepository", () => {
  it(
    "reports not run when it is unticked and there is no stored file",
    async () => {
      const root = await inProcessAppRoot({ uncommitted: true });
      const loaded = await awaitLoaded(root);

      expect(statusOf(loaded.sensors ?? [], "structure")).toEqual({
        name: "structure",
        status: "not run",
      });
      expect(loaded.findings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "matches the violation and warning ids of fixtures/check/expected.json",
    async () => {
      const expected = JSON.parse(
        readFileSync(join(REPO, "fixtures/check/expected.json"), "utf8"),
      ) as {
        violations: { from: string; rule: ViolatedRule }[];
        warnings: { id: string; evidence: { modules?: string[] } }[];
      };
      const root = await inProcessAppRoot({
        uncommitted: true,
        files: {
          [POLICY_AT]: policy,
          [findingsAt("structure")]: documentText(
            structureDocument("check", policy),
          ),
        },
      });
      const loaded = await awaitLoaded(root);
      const document = loaded.findings.find(
        (one) => one.sensor.name === "structure",
      );
      const findings = [
        ...(loaded.split.structure?.shown ?? []),
        ...(loaded.split.structure?.hidden ?? []),
      ];
      const violations = findings
        .filter((record) => record.severity === "violation")
        .map((record) => record.id)
        .sort();
      const warnings = findings.filter(
        (record) => record.severity === "warning",
      );

      expect(document).toBeDefined();
      expect(violations).toEqual(
        expected.violations
          .map((one) => violationId({ file: one.from, rule: one.rule }))
          .sort(),
      );
      expect(warnings).toHaveLength(expected.warnings.length);
    },
    TIMEOUT,
  );

  it(
    "removes the structure file when the sensor is off",
    async () => {
      const root = await inProcessAppRoot({
        config: "sensors:\n  structure: off\n",
      });
      const loaded = await awaitLoaded(root);

      expect(statusOf(loaded.sensors ?? [], "structure")).toEqual({
        name: "structure",
        status: "off",
      });
      expect(
        loaded.findings.map((document) => document.sensor.name),
      ).not.toContain("structure");
    },
    TIMEOUT,
  );

  it(
    "keeps unknown files on the structure status",
    async () => {
      const unknownFiles = { languages: ["swift"], files: ["a.swift"] };
      const withStatus = statusOf(
        await statusesOf(
          await inProcessAppRoot({
            uncommitted: true,
            files: {
              [findingsAt("structure")]: documentText({
                ...structureDocument("check", policy),
                unknownFiles,
              }),
            },
          }),
        ),
        "structure",
      );
      const withoutStatus = statusOf(
        await statusesOf(
          await inProcessAppRoot({
            uncommitted: true,
            files: {
              [findingsAt("structure")]: documentText(
                structureDocument("check", policy),
              ),
            },
          }),
        ),
        "structure",
      );

      expect(withStatus).toMatchObject({ status: "ran", unknownFiles });
      expect(withoutStatus).toMatchObject({ status: "ran" });
      expect(withoutStatus).not.toHaveProperty("unknownFiles");
    },
    TIMEOUT,
  );

  it(
    "an_unreadable_findings_file_is_shown_unreadable_and_kept",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [findingsAt("lint")]: "{not json",
          [findingsAt("evil")]: "{not json",
        },
      });
      const statuses = await statusesOf(root);

      expect(statusOf(statuses, "structure")).toMatchObject({ status: "ran" });
      expect(statusOf(statuses, "lint")).toMatchObject({ status: "failed" });
      expect(statusOf(statuses, "evil")).toMatchObject({ status: "failed" });

      for (const name of ["lint", "evil"]) {
        const path = `${root.repository}/${findingsAt(name)}`;

        expect(root.io.files.exists(path)).toBe(true);
        expect(root.io.files.readBytes(path).toString()).toBe("{not json");
      }
    },
    TIMEOUT,
  );

  it(
    "keeps a file from another commit and reports it ran, leaving staleness to the freshness answer",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [findingsAt("lint")]: documentText(
            secondSensorDocument("shop/main.py", "x", "y", "old"),
          ),
        },
      });
      const loaded = await awaitLoaded(root);

      expect(statusOf(loaded.sensors ?? [], "lint")).toMatchObject({
        name: "lint",
        status: "ran",
        findings: 1,
        modifiedMs: null,
        commit: "old",
      });
      expect(loaded.findings.map((one) => one.sensor.name)).toContain("lint");
      expect(
        root.io.files.exists(`${root.repository}/${findingsAt("lint")}`),
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "lists a registered sensor with no file as not run, never failed",
    async () => {
      const root = await inProcessAppRoot({ config: COVERAGE });

      expect(statusOf(await statusesOf(root), "coverage")).toEqual({
        name: "coverage",
        status: "not run",
      });
    },
    TIMEOUT,
  );

  it(
    "shows ran, failed and not run together",
    async () => {
      const root = await inProcessAppRoot({
        config: COVERAGE,
        files: {
          [findingsAt("lint")]: documentText(
            secondSensorDocument("shop/main.py", "x", "y", "old"),
          ),
          [findingsAt("broken")]: "[]",
        },
      });
      const statuses = await statusesOf(root);
      const picked = ["structure", "broken", "lint", "coverage"].map((name) =>
        statusOf(statuses, name),
      );

      expect(picked.every((one) => one !== undefined)).toBe(true);
      expect(picked.map((one) => [one?.name, one?.status])).toEqual([
        ["structure", "ran"],
        ["broken", "failed"],
        ["lint", "ran"],
        ["coverage", "not run"],
      ]);
    },
    TIMEOUT,
  );

  it(
    "carries a findings document's stopped and partial keys onto its status",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [findingsAt("lint")]: documentText({
            ...secondSensorDocument("shop/main.py"),
            stopped: { measured: 1, total: 3 },
            partial: { measured: 1, total: 3 },
          }),
        },
      });

      expect(statusOf(await statusesOf(root), "lint")).toMatchObject({
        stopped: { measured: 1, total: 3 },
        partial: { measured: 1, total: 3 },
      });
    },
    TIMEOUT,
  );

  it(
    "carries a findings document's excluded key onto its status",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [findingsAt("lint")]: documentText({
            ...secondSensorDocument("shop/main.py"),
            excluded: { functions: 2, files: ["shop/main.py"] },
          }),
        },
      });

      expect(statusOf(await statusesOf(root), "lint")).toMatchObject({
        excluded: { functions: 2, files: ["shop/main.py"] },
      });
    },
    TIMEOUT,
  );

  it(
    "carries a findings document's unowned key onto its status",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [findingsAt("lint")]: documentText({
            ...secondSensorDocument("shop/main.py"),
            unowned: { functions: 2, files: ["shop/main.py"] },
          }),
        },
      });

      expect(statusOf(await statusesOf(root), "lint")).toMatchObject({
        unowned: { functions: 2, files: ["shop/main.py"] },
      });
    },
    TIMEOUT,
  );

  it(
    "reads a current file from a second sensor",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [findingsAt("lint")]: documentText(
            secondSensorDocument("shop/main.py"),
          ),
        },
      });
      const loaded = await awaitLoaded(root);

      expect(statusOf(loaded.sensors ?? [], "lint")).toMatchObject({
        name: "lint",
        status: "ran",
        findings: 1,
        modifiedMs: null,
        commit: "abc1234",
        measured: { inputs: expect.any(Object) },
      });
      expect(
        loaded.findings
          .map((one) => one.sensor.name)
          .filter((name) => name === "structure" || name === "lint"),
      ).toEqual(["structure", "lint"]);
    },
    TIMEOUT,
  );
  it(
    "falls back without a policy when the policy uses a retired key",
    async () => {
      const root = await inProcessAppRoot({
        uncommitted: true,
        files: {
          [POLICY_AT]: "components:\n  one: shop/**\n",
          [findingsAt("structure")]: documentText(
            structureDocument("check", policy),
          ),
        },
      });
      const statuses = await statusesOf(root);

      expect(statusOf(statuses, "policy.yaml")).toMatchObject({
        status: "failed",
      });
      expect(statusOf(statuses, "structure")).toMatchObject({ status: "ran" });
    },
    TIMEOUT,
  );
});

describe("senseRepository and reports", () => {
  const reported = (name: string, commit: string) =>
    documentText({
      ...secondSensorDocument("shop/main.py", "x", "y", commit),
      sensor: { name, version: "reported" },
      reportedAt: "2026-11-02T10:00:00.000Z",
    });

  it(
    "marks a document with reported_at as reported and keeps ran or stale",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [findingsAt("review")]: reported("review", CURRENT),
          [findingsAt("older")]: reported("older", "old1234567"),
        },
      });
      const loaded = await awaitLoaded(root);
      const statuses = loaded.sensors ?? [];

      expect(statusOf(statuses, "review")).toMatchObject({
        name: "review",
        status: "ran",
        findings: 1,
        modifiedMs: null,
        commit: CURRENT,
        reported: { at: "2026-11-02T10:00:00.000Z", commit: CURRENT },
      });
      expect(statusOf(statuses, "older")).toMatchObject({
        status: "ran",
        reported: { commit: "old1234567" },
      });
      expect(loaded.findings.map((one) => one.sensor.name)).toContain("review");
    },
    TIMEOUT,
  );

  it(
    "leaves a registered name carrying the mark unmarked and an unmarked file unmarked",
    async () => {
      const root = await inProcessAppRoot({
        config: "sensors:\n  lint:\n    command: [lint]\n",
        files: {
          [findingsAt("lint")]: reported("lint", CURRENT),
          [findingsAt("plain")]: documentText({
            ...secondSensorDocument("shop/main.py"),
            sensor: { name: "plain", version: "1" },
          }),
        },
      });
      const statuses = await statusesOf(root);

      expect(statusOf(statuses, "lint")).toMatchObject({ status: "ran" });
      expect(statusOf(statuses, "plain")).toMatchObject({ status: "ran" });
      expect(statusOf(statuses, "lint")).not.toHaveProperty("reported");
      expect(statusOf(statuses, "plain")).not.toHaveProperty("reported");
    },
    TIMEOUT,
  );
});

describe("withSensors tests hash", () => {
  it(
    "stores the hash the port reads, handing it no known hashes so tests are hashed from disk",
    async () => {
      const bytes = "export const t = 'rewritten before the first load';\n";
      const root = await inProcessAppRoot({
        stamped: true,
        files: { "api/tests/a.test.ts": bytes },
      });
      const sha = (text: string) =>
        createHash("sha256").update(text).digest("hex");

      expect((await awaitLoaded(root)).tests).toBe(
        sha(`api/tests/a.test.ts\t${sha(bytes)}\n`),
      );
    },
    TIMEOUT,
  );
});

describe("withSensors", () => {
  it(
    "carries the documents, statuses, policy and baseline on Loaded",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [POLICY_AT]: policy,
          ".recognizer/baselines/violations.json": JSON.stringify({
            schema_version: 1,
            violations: [],
          }),
        },
      });
      const loaded = await awaitLoaded(root);

      expect(loaded.modules.length).toBeGreaterThan(0);
      expect(loaded.findings.map((document) => document.sensor.name)).toContain(
        "structure",
      );
      expect(statusOf(loaded.sensors ?? [], "structure")).toMatchObject({
        status: "ran",
        modified: false,
      });
      expect(loaded.policy).toEqual(parsePolicy(policy));
      expect(loaded.baseline).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "carries the overlay files and the names the read refused",
    async () => {
      const root = await inProcessAppRoot({
        files: {
          [overlayAt("other")]: EMPTY_OVERLAY,
          [overlayAt("extra")]: EMPTY_OVERLAY,
          [overlayAt("evil")]: "{not json",
        },
      });
      const loaded = await awaitLoaded(root);
      const overlays = (loaded.overlays ?? []).filter(({ name }) =>
        ["other", "extra"].includes(name),
      );

      expect(overlays).toEqual([
        { name: "extra", overlay: JSON.parse(EMPTY_OVERLAY), modifiedMs: null },
        { name: "other", overlay: JSON.parse(EMPTY_OVERLAY), modifiedMs: null },
      ]);
      expect(loaded.overlaysUnreadable).toContain("evil");
    },
    TIMEOUT,
  );
});

const SUITES = readFileSync(
  join(REPO, "schema/config-examples/valid/tests-python-activate.yaml"),
  "utf8",
);
const MINUTE = 60000;
const NOW = 100 * MINUTE;

function configWith(sensors: string, suites = true): string {
  return `${suites ? SUITES : ""}sensors:\n${sensors}`;
}

const UNDECLARED = "  lint:\n    command: [node, lint.mjs, run]\n";
const DECLARED =
  "  lint:\n    command: [node, lint.mjs, run]\n    manifest: [node, lint.mjs, manifest]\n";

function lintRoot(config: string) {
  return inProcessAppRoot({
    config,
    files: {
      [findingsAt("lint")]: documentText(secondSensorDocument("shop/main.py")),
    },
  });
}

async function panelOf(root: Root, sensors: SensorStatus[]) {
  const host = await untilHolds(root.service, () => root.view.explorer()?.host);
  const modules = ["a.py"];
  const input: PanelInput = {
    scan: {
      origin: { branch: "main", commit: "abc1234" },
      scannedAt: NOW - MINUTE,
      changes: NO_CHANGES,
      scanning: null,
    },
    config: (await host.port.inputs()).config,
    sensors,
    lines: {
      modules,
      of: () => ({ kind: "current", line: "x" }) as ResponsibilityState,
    },
    describedAt: null,
    ticks: {
      describe: false,
      analysis: true,
      ticked: [],
      armed: [],
      onlyView: false,
      suites: {},
      folds: [],
    },
    run: NO_RUN,
    scanning: false,
    now: NOW,
    installed: { status: "ok", sensors: [] },
  };

  return scanPanelAsked(input);
}

describe("a registered sensor with no manifest in the Scan panel", () => {
  it(
    "marks the status not measured and carries the notice and the fix",
    async () => {
      const root = await lintRoot(configWith(UNDECLARED));
      const lint = statusOf(await statusesOf(root), "lint");

      expect(lint?.status).toBe("ran");
      expect(lint?.notMeasured).toEqual(["suites"]);
      expect(lint?.undeclared?.line).toContain(
        "lint declares nothing until its manifest is added",
      );
      expect(lint?.undeclared?.fix).toContain(
        "recognizer config --add sensors.lint.manifest <first word>",
      );
    },
    TIMEOUT,
  );

  it(
    "gives the row a note with the fix and a state other than the clean one",
    async () => {
      const root = await lintRoot(configWith(UNDECLARED));
      const model = await panelOf(root, await statusesOf(root));
      const row = model.rows.find((one) => one.key === "lint");

      expect(row?.note).toContain(
        "recognizer config --add sensors.lint.manifest",
      );
      expect(row?.state.kind).toBe("not-measured");
      expect(row?.text.text).toBe("not measured");
    },
    TIMEOUT,
  );

  it(
    "carries the notice but no not-measured mark when no suites are configured",
    async () => {
      const root = await lintRoot(configWith(UNDECLARED, false));
      const lint = statusOf(await statusesOf(root), "lint");

      expect(lint).toBeDefined();
      expect(lint?.notMeasured).toBeUndefined();
      expect(lint?.undeclared).toBeDefined();
    },
    TIMEOUT,
  );

  it(
    "shows nothing of it for a sensor with a manifest",
    async () => {
      const root = await lintRoot(configWith(DECLARED));
      const found = await statusesOf(root);
      const lint = statusOf(found, "lint");
      const model = await panelOf(root, found);
      const row = model.rows.find((one) => one.key === "lint");

      expect(lint).toBeDefined();
      expect(lint?.notMeasured).toBeUndefined();
      expect(lint?.undeclared).toBeUndefined();
      expect(row?.state.kind).not.toBe("not-measured");
      expect(row?.note ?? "").not.toContain("declares nothing");
    },
    TIMEOUT,
  );

  it(
    "marks only the sensor with no manifest among two registered ones",
    async () => {
      const root = await inProcessAppRoot({
        config: configWith(
          `${UNDECLARED}  other:\n    command: [node, other.mjs, run]\n    manifest: [node, other.mjs, manifest]\n`,
        ),
        files: {
          [findingsAt("lint")]: documentText(
            secondSensorDocument("shop/main.py"),
          ),
          [findingsAt("other")]: documentText({
            ...secondSensorDocument("shop/main.py"),
            sensor: { name: "other", version: "1" },
          }),
        },
      });
      const found = await statusesOf(root);

      expect(statusOf(found, "other")).toMatchObject({ status: "ran" });
      expect(statusOf(found, "lint")?.undeclared).toBeDefined();
      expect(statusOf(found, "other")?.undeclared).toBeUndefined();
      expect(statusOf(found, "other")?.notMeasured).toBeUndefined();
    },
    TIMEOUT,
  );
});
