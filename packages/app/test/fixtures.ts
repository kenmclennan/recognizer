import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Finding, Repository, type SensorFindings } from "@recognizer/core";
import {
  buildFreshness,
  type Config,
  comparePlugins,
  describeGap,
  freshnessScope,
  gapOf,
  measuredInputs,
  type PaneDescriber,
  type PaneSensor,
  type PlanRequest,
  type PlanRow,
  parseConfig,
  parsePolicy,
  planFor,
  planScan,
  type ScanPlanView,
  sensorFreshness,
  structureSensor,
} from "recognizer";
import type { FreshnessModel } from "../src/freshness-text";
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
import type { InstalledSensor } from "../src/sensor-run";
import { BEHAVIOUR } from "./language-behaviour";
import type { DocScan } from "./unit/repository-from";
import { repositoryFrom } from "./unit/repository-from";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function fixtureScan(
  name: string,
  file = "scan.json",
  commit: string | null = null,
): LoadedScan & { document: DocScan } {
  const text = readFileSync(join(REPO, "fixtures", name, file), "utf8");
  const document = { ...JSON.parse(text), commit } as DocScan;

  return {
    file: "scan.python.json",
    repository: repositoryFrom([document]),
    document,
  };
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

  return (JSON.parse(text) as DocScan).modules.map((module) => module.id);
}

export function expectedScan(language: string): DocScan {
  const text = readFileSync(
    join(REPO, "fixtures", language, "expected-scan.json"),
    "utf8",
  );

  return JSON.parse(text) as DocScan;
}

export const CURRENT = "abc1234";

export function structureDocument(
  name: string,
  policyText: string | null,
  commit = CURRENT,
): SensorFindings {
  const { repository } = fixtureScan(name, "scan.json", commit);
  const policy = policyText === null ? null : parsePolicy(policyText);
  const { document } = structureSensor(
    repository,
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
    BEHAVIOUR,
  );

  return commit === CURRENT ? document : outOfDate(document);
}

function outOfDate(document: SensorFindings): SensorFindings {
  return {
    ...document,
    inputs: Object.fromEntries(
      Object.keys(document.inputs ?? {}).map((id) => [id, "0".repeat(64)]),
    ),
  };
}

function checkInputs(): Record<string, string> {
  const { repository } = fixtureScan("check", "scan.json", CURRENT);

  return measuredInputs(repository);
}

export function secondSensorDocument(
  module: string,
  summary = "too many magic numbers",
  principle = "name-your-constants",
  commit = CURRENT,
): SensorFindings {
  const document: SensorFindings = {
    sensor: { name: "lint", version: "1" },
    commit,
    modified: false,
    settings: {},
    inputs: checkInputs(),
    findings: [
      Finding.stored({
        id: `magic:${module}`,
        kind: "magic-numbers",
        severity: "warning",
        principle,
        summary,
        files: [module],
      }),
    ],
  };

  return commit === CURRENT ? document : outOfDate(document);
}

export function planSync(
  request: PlanRequest,
  facts: LoadedPlanData,
): ScanPlanView {
  const scans = facts.scans;
  const all = scans.files.map(({ path }) => path);

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
  sensors: RowSensor[] = rowSensors(input.config, input.installed),
): PanelInput {
  const tests =
    input.tests ??
    input.sensors.find(({ measured }) => measured?.tests !== undefined)
      ?.measured?.tests;
  const known = new Set(
    (input.scans ?? Repository.empty).files.map(({ path }) => path),
  );
  const missing = input.lines.modules.filter((id) => !known.has(id));
  const scans =
    missing.length === 0
      ? (input.scans ?? Repository.empty)
      : Repository.join([
          input.scans ?? Repository.empty,
          repositoryFrom([
            {
              modules: missing.map((id) => ({
                id,
                members: [{ kind: "function" }],
              })),
              edges: [],
              files: [],
            } as unknown as DocScan,
          ]),
        ]);
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

export function configOf(text: string | null): Config | null {
  if (text === null) {
    return null;
  }

  try {
    return parseConfig(text);
  } catch {
    return null;
  }
}

const EXAMPLES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schema/manifest-examples/valid",
);

const SENSOR_EXAMPLE = /^sensor-(.+)\.json$/;

export function installedNames(): string[] {
  return readdirSync(EXAMPLES)
    .map((file) => SENSOR_EXAMPLE.exec(file)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

type ManifestDocument = Omit<
  InstalledSensor,
  "runsTests" | "listed" | "plannedWork" | "logPath"
> & {
  runs_tests: boolean;
  planned_work?: { verb: string };
  log_path?: string;
};

export function installedSensor(name: string): InstalledSensor {
  const { runs_tests, ...rest } = JSON.parse(
    readFileSync(join(EXAMPLES, `sensor-${name}.json`), "utf8"),
  ) as ManifestDocument;

  return {
    name: rest.name,
    display: rest.display,
    description: rest.description,
    ...(rest.expansion === undefined ? {} : { expansion: rest.expansion }),
    ...(rest.settings_title === undefined
      ? {}
      : { settings_title: rest.settings_title }),
    runsTests: runs_tests,
    scoped: rest.scoped,
    ...(rest.planned_work === undefined
      ? {}
      : { plannedWork: rest.planned_work }),
    ...(rest.log_path === undefined ? {} : { logPath: rest.log_path }),
    listed: rest.metrics.length > 0,
    metrics: rest.metrics,
    findings: rest.findings,
    settings: rest.settings,
    ...(rest.principles === undefined ? {} : { principles: rest.principles }),
  };
}

export function installedSensors(): InstalledSensor[] {
  return installedNames().map(installedSensor).sort(comparePlugins);
}

export function paneSources(): {
  sensors: PaneSensor[];
  describers: PaneDescriber[];
} {
  const read = (file: string) =>
    JSON.parse(readFileSync(join(EXAMPLES, file), "utf8")) as PaneSensor &
      PaneDescriber;

  return {
    sensors: installedNames()
      .map((name) => read(`sensor-${name}.json`))
      .sort(comparePlugins),
    describers: [read("describer.json")],
  };
}

export function plainSensor(
  name: string,
  over: Partial<InstalledSensor> = {},
): InstalledSensor {
  return {
    name,
    display: name,
    description: "",
    runsTests: false,
    scoped: false,
    listed: true,
    metrics: [],
    findings: [],
    settings: [],
    ...over,
  };
}
