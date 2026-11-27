import type {
  Diagnosis,
  DocumentFreshness,
  Finding,
  PolicyRule,
  Principle,
  SensorExclusion,
  SensorFindingsHeader,
  SuiteStanding,
  UnknownFiles,
} from "@recognizer/core";
import {
  type Config,
  complexityUnmeasured,
  duplicationUnmeasured,
  type FindingEntry,
  type Overlay,
  registeredSensors,
  resolveStructureSettings,
  undeclaredSensors,
} from "recognizer";
import type { PlannedWork } from "./estimate-text";
import type { Loaded, LoadedScan } from "./scan-loading";
import { scansCommit } from "./scans-commit";

export type SensorStatus = {
  name: string;
  status: "ran" | "failed" | "off" | "stale" | "not run";
  reason?: string;
  findings?: number;
  modifiedMs?: number | null;
  reported?: { at: string; commit: string };
  notMeasured?: string[];
  undeclared?: { line: string; fix: string };
  commit?: string;
  modified?: boolean;
  stopped?: { measured: number; total: number };
  partial?: { measured: number; total: number };
  excluded?: SensorExclusion;
  unowned?: SensorExclusion;
  unknownFiles?: UnknownFiles;
  diagnosis?: Diagnosis;
  refusal?: Refusal;
  measured?: { inputs?: Record<string, string>; tests?: string };
  suites?: readonly SuiteStanding[];
};

export type Refusal = { reason: string; diagnosis?: Diagnosis; at: number };

export type FindingsFiles = {
  files: {
    name: string;
    document: SensorFindingsHeader;
    modifiedMs: number | null;
    shown: Finding[];
    hidden: Finding[];
    measured: string[];
    suites?: SuiteStanding[] | null;
  }[];
  refused: string[];
};

export type OverlayFiles = {
  files: { name: string; overlay: Overlay; modifiedMs: number | null }[];
  refused: string[];
};

export type StoredResults = {
  findings: FindingsFiles;
  overlays: OverlayFiles;
  refusals: Record<string, Refusal>;
  freshness: Record<string, DocumentFreshness>;
  lastRun: string | null;
};

export type SensorInputs = {
  configText: string | null;
  config: Config | null;
  configProblem: string | null;
  registeredSensors: string[];
  policy: PolicyRule[] | null;
  policyProblem: string | null;
  baseline: string[] | null;
  baselineProblem: string | null;
  refused: string[];
};

export type InstalledSensor = {
  name: string;
  display: string;
  description: string;
  expansion?: string;
  settings_title?: string;
  runsTests: boolean;
  scoped: boolean;
  plannedWork?: { verb: string };
  logPath?: string;
  listed: boolean;
  metrics: InstalledMetric[];
  findings: FindingEntry[];
  settings: InstalledSetting[];
  principles?: Principle[];
};

export type InstalledMetric = {
  name: string;
  label: string;
  title: string;
  help: string;
  type: "ratio" | "count" | "number" | "boolean";
  granularity: "module" | "member";
  bad: "high" | "low";
  cell?: number;
  unlisted?: boolean;
  published?: { value: number; source: string };
};

export type InstalledSetting = {
  key: string;
  type: string;
  values?: string[];
  default?: string | number | boolean;
  defaults?: Record<string, string | number | boolean>;
  label?: string;
  labels?: Record<string, string>;
  unit?: string;
  units?: Record<string, string>;
  order?: number;
  limit?: {
    metric: string;
    direction: "above" | "below";
    severity?: string;
  };
};

export type DescriberInEffect =
  | {
      status: "ok";
      command: string[];
      version: string;
    }
  | { status: "unavailable"; reason: string };

export type InstalledSensors =
  | { status: "ok"; sensors: InstalledSensor[] }
  | { status: "unavailable"; reason: string };

export type WorkRequest = {
  sensor: string;
  modules: string[] | null;
  suites: string[] | null;
};

export type SensorsPort = {
  readResults(tests?: string | null): Promise<StoredResults>;
  readTestsHash(known: Record<string, string>): Promise<string | null>;
  clearResults(name: string): Promise<void>;
  inputs(): Promise<SensorInputs>;
  sensorList(): Promise<InstalledSensors>;
  describer(): Promise<DescriberInEffect>;
  plannedWork(request: WorkRequest): Promise<PlannedWork | null>;
};

export const NO_INPUTS: SensorInputs = {
  configText: null,
  config: null,
  configProblem: null,
  registeredSensors: [],
  policy: null,
  policyProblem: null,
  baseline: null,
  baselineProblem: null,
  refused: [],
};

export const inertSensors: SensorsPort = {
  readResults: async () => ({
    findings: { files: [], refused: [] },
    overlays: { files: [], refused: [] },
    refusals: {},
    freshness: {},
    lastRun: null,
  }),
  readTestsHash: async () => null,
  clearResults: async () => {},
  inputs: async () => NO_INPUTS,
  sensorList: async () => ({
    status: "unavailable",
    reason: "the installed sensors are not available",
  }),
  describer: async () => ({
    status: "unavailable",
    reason: "the describer is not available",
  }),
  plannedWork: async () => null,
};

export type SensorRun = {
  documents: SensorFindingsHeader[];
  statuses: SensorStatus[];
};

export { scansCommit };

export async function senseRepository(
  _scans: LoadedScan[],
  inputs: Pick<SensorInputs, "config" | "configProblem" | "policyProblem">,
  port: Pick<SensorsPort, "readResults">,
): Promise<SensorRun> {
  const statuses: SensorStatus[] = [];
  const { config } = inputs;

  if (inputs.configProblem !== null) {
    statuses.push({
      name: "config.yaml",
      status: "failed",
      reason: inputs.configProblem,
    });
  }

  if (inputs.policyProblem !== null) {
    statuses.push({
      name: "policy.yaml",
      status: "failed",
      reason: inputs.policyProblem,
    });
  }

  const settings = resolveStructureSettings(config);
  const documents: SensorFindingsHeader[] = [];
  const read = (await port.readResults()).findings;
  let structure: SensorFindingsHeader | null = null;
  let structureRan = false;

  if (settings === "off") {
    statuses.push({ name: "structure", status: "off" });
  } else {
    const file = read.files.find(({ name }) => name === "structure");

    if (file === undefined) {
      statuses.push({ name: "structure", status: "not run" });
    } else {
      try {
        const stored = file.document;
        const notMeasured = [
          ...(duplicationUnmeasured(stored, settings) ? ["duplication"] : []),
          ...(complexityUnmeasured(stored, settings) ? ["complexity"] : []),
        ];

        structure = stored;
        structureRan = true;
        statuses.push({
          name: "structure",
          status: "ran",
          commit: stored.commit,
          modified: stored.modified,
          modifiedMs: file.modifiedMs ?? null,
          ...(notMeasured.length > 0 ? { notMeasured } : {}),
          ...(stored.unknownFiles === undefined
            ? {}
            : { unknownFiles: stored.unknownFiles }),
        });
      } catch (error) {
        statuses.push({
          name: "structure",
          status: "failed",
          reason: (error as Error).message,
        });
      }
    }
  }

  const registered = registeredSensors(config).map(({ name }) => name);

  for (const name of read.refused) {
    statuses.push({ name, status: "failed", reason: "could not be read" });
  }

  for (const file of read.files) {
    if (file.name === "structure") {
      continue;
    }

    try {
      const document = file.document;

      documents.push(document);
      statuses.push({
        name: file.name,
        status: "ran",
        measured: {
          ...(document.inputs !== undefined ? { inputs: document.inputs } : {}),
          ...(document.tests !== undefined ? { tests: document.tests } : {}),
        },
        findings: file.shown.length + file.hidden.length,
        modifiedMs: file.modifiedMs ?? null,
        commit: document.commit,
        ...(document.stopped !== undefined
          ? { stopped: document.stopped }
          : {}),
        ...(document.partial !== undefined
          ? { partial: document.partial }
          : {}),
        ...(document.excluded !== undefined
          ? { excluded: document.excluded }
          : {}),
        ...(document.unowned !== undefined
          ? { unowned: document.unowned }
          : {}),
        ...(document.diagnosis !== undefined
          ? { diagnosis: document.diagnosis }
          : {}),
        ...(file.suites != null ? { suites: file.suites } : {}),
        ...(document.reportedAt !== undefined && !registered.includes(file.name)
          ? { reported: { at: document.reportedAt, commit: document.commit } }
          : {}),
      });
    } catch (error) {
      statuses.push({
        name: file.name,
        status: "failed",
        reason: (error as Error).message,
      });
    }
  }

  if (structure !== null && structureRan) {
    documents.unshift(structure);
  }

  for (const name of registered) {
    if (!statuses.some((status) => status.name === name)) {
      statuses.push({ name, status: "not run" });
    }
  }

  for (const notice of undeclaredSensors(
    registeredSensors(config),
    (config?.tests ?? []).length > 0,
  )) {
    const at = statuses.findIndex((status) => status.name === notice.name);
    const status = statuses[at];

    if (status !== undefined) {
      statuses[at] = {
        ...status,
        ...(notice.suitesWithheld
          ? {
              notMeasured: [
                ...new Set([...(status.notMeasured ?? []), "suites"]),
              ],
            }
          : {}),
        undeclared: { line: notice.line, fix: notice.fix },
      };
    }
  }

  return {
    documents,
    statuses,
  };
}

function splitOf(files: FindingsFiles["files"]): Loaded["split"] {
  const split: Loaded["split"] = {};

  for (const { name, shown, hidden } of files) {
    split[name] = { shown, hidden };
  }

  return split;
}

function measuredOf(files: FindingsFiles["files"]): Loaded["measured"] {
  const measured: Loaded["measured"] = {};

  for (const { name, measured: ids } of files) {
    measured[name] = ids;
  }

  return measured;
}

export async function withSensors(
  loaded: Loaded,
  port: SensorsPort,
): Promise<Loaded> {
  const inputs = await port.inputs();
  const tests = await port.readTestsHash({}).catch(() => null);
  const stored = await port.readResults(tests);
  const run = await senseRepository(loaded.scans, inputs, {
    readResults: async () => stored,
  });
  const overlays = stored.overlays;
  const refusals = stored.refusals;

  return {
    ...loaded,
    policy: inputs.policy,
    baseline: inputs.baseline,
    baselineProblem: inputs.baselineProblem,
    findings: run.documents,
    sensors: run.statuses.map((status) =>
      status.status !== "failed" && refusals[status.name] !== undefined
        ? { ...status, refusal: refusals[status.name] }
        : status,
    ),
    overlays: overlays.files,
    overlaysUnreadable: overlays.refused,
    tests,
    freshness: stored.freshness,
    split: splitOf(stored.findings.files),
    measured: measuredOf(stored.findings.files),
    lastRun: stored.lastRun,
  };
}
