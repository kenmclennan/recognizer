import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFreshness,
  describeGap,
  type FindingsDocument,
  freshnessScope,
  gapOf,
  measuredInputs,
  type PlanRequest,
  type PlanRow,
  parsePolicy,
  planFor,
  planScan,
  type Scan,
  type ScanPlanView,
  sensorFreshness,
  structureSensor,
} from "recognizer";
import type { FreshnessModel } from "../src/freshness-model";
import type { LoadedPlanData } from "../src/plan-reads";
import {
  type PlannedRun,
  plannedRun as plannedFromView,
  type ResultsMode,
} from "../src/scan-freshness";
import type { LoadedScan } from "../src/scan-loading";
import {
  type PanelInput,
  planFactsOf,
  planRequestOf,
  type RowSensor,
  rowSensors,
  type ScanPanelModel,
  type ScanTicks,
  scanPanel,
} from "../src/scan-panel-model";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function fixtureScan(
  name: string,
  file = "scan.json",
  commit: string | null = null,
): LoadedScan {
  const text = readFileSync(join(REPO, "fixtures", name, file), "utf8");
  const scan = { ...JSON.parse(text), commit } as Scan;

  return { file: "scan.python.json", scan };
}

export function fixturePolicy(name: string): string {
  return readFileSync(
    join(REPO, "fixtures", name, ".recognizer/policy.yaml"),
    "utf8",
  );
}

export function fixtureBaseline(name: string): string {
  return readFileSync(
    join(REPO, "fixtures", name, ".recognizer/baselines/violations.json"),
    "utf8",
  );
}

export function expectedModuleIds(language: string): string[] {
  const text = readFileSync(
    join(REPO, "fixtures", language, "expected-scan.json"),
    "utf8",
  );

  return (JSON.parse(text) as Scan).modules.map((module) => module.id);
}

export function expectedScan(language: string): Scan {
  const text = readFileSync(
    join(REPO, "fixtures", language, "expected-scan.json"),
    "utf8",
  );

  return JSON.parse(text) as Scan;
}

export const CURRENT = "abc1234";

export function structureDocument(
  name: string,
  policyText: string | null,
  commit = CURRENT,
): FindingsDocument {
  const { scan } = fixtureScan(name, "scan.json", commit);
  const policy = policyText === null ? null : parsePolicy(policyText);
  const { document } = structureSensor(
    [scan],
    policy,
    {
      duplication: false,
      entry_points: [],
      entry_annotations: [],
      warnings: {
        cycle: true,
        orphan: true,
        unused_exports: false,
        private_imports: true,
        long_function: true,
        complexity: true,
      },
      long_function_limit: 20,
      complexity_limit: 10,
    },
    { commit, modified: false },
  );

  return commit === CURRENT ? document : outOfDate(document);
}

function outOfDate(document: FindingsDocument): FindingsDocument {
  return {
    ...document,
    inputs: Object.fromEntries(
      Object.keys(document.inputs ?? {}).map((id) => [id, "0".repeat(64)]),
    ),
  };
}

function checkInputs(): Record<string, string> {
  const { scan } = fixtureScan("check", "scan.json", CURRENT);

  return measuredInputs([scan]);
}

export function secondSensorDocument(
  module: string,
  summary = "too many magic numbers",
  principle = "name-your-constants",
  commit = CURRENT,
): FindingsDocument {
  const document: FindingsDocument = {
    findings_version: 1,
    sensor: { name: "lint", version: "1" },
    commit,
    modified: false,
    settings: {},
    inputs: checkInputs(),
    findings: [
      {
        id: `magic:${module}`,
        kind: "magic-numbers",
        severity: "warning",
        principle,
        summary,
        evidence: { modules: [module] },
      },
    ],
  };

  return commit === CURRENT ? document : outOfDate(document);
}

export function planSync(
  request: PlanRequest,
  facts: LoadedPlanData,
): ScanPlanView {
  const scans = facts.scans as unknown as Scan[];
  const all = scans.flatMap((scan) => scan.modules.map(({ id }) => id));

  return planScan(
    {
      readSensorRows: () => facts.sensors,
      readModules: () => all,
      findSensorGaps: (_root, rows, modules) => {
        const freshness = buildFreshness(scans, facts.tests);
        const scope = freshnessScope(modules, scans, freshness);
        const gaps: Record<string, string[]> = {};
        const never: string[] = [];

        for (const row of rows.filter(({ registered }) => registered)) {
          const result = sensorFreshness(
            scope,
            facts.measured[row.name] ?? null,
            row.scoped,
          );

          gaps[row.name] = gapOf(result, modules);

          if (result.kind === "never-run") {
            never.push(row.name);
          }
        }

        return { gaps, never };
      },
      findDescribeGap: (_root, modules) =>
        facts.describerRegistered
          ? describeGap((id) => facts.lineKinds(id), modules).stale
          : null,
    },
    request,
  );
}

export function withPlan(
  input: PanelInput,
  sensors: RowSensor[] = rowSensors(input.config, input.shipped),
): PanelInput {
  const tests =
    input.tests ??
    input.sensors.find(({ measured }) => measured?.tests !== undefined)
      ?.measured?.tests;
  const known = new Set(
    (input.scans ?? []).flatMap((scan) => scan.modules.map(({ id }) => id)),
  );
  const missing = input.lines.modules.filter((id) => !known.has(id));
  const scans =
    missing.length === 0
      ? (input.scans ?? [])
      : [
          ...(input.scans ?? []),
          {
            modules: missing.map((id) => ({
              id,
              members: [{ kind: "function" }],
            })),
            files: [],
          } as unknown as Scan,
        ];
  const given = { ...input, scans, tests: tests ?? null };

  return {
    ...input,
    plan: {
      view: planSync(
        planRequestOf(given, sensors),
        planFactsOf(given, sensors),
      ),
      settled: true,
    },
  };
}

export function scanPanelSync(input: PanelInput): ScanPanelModel {
  return scanPanel(withPlan(input));
}

export function plannedRun(
  model: FreshnessModel,
  mode: ResultsMode,
  ticks: ScanTicks,
  rows: (PlanRow & { display?: string })[],
  scope: string[] | null,
  all: string[],
): PlannedRun {
  const view = planFor(
    { mode, ticks, scope, changed: model.update },
    rows,
    {
      gaps: model.gaps,
      never: new Set(
        model.rows
          .filter(({ state }) => state.kind === "never-run")
          .map(({ key }) => key),
      ),
    },
    all,
  );

  return plannedFromView(model, mode, view, rows);
}
