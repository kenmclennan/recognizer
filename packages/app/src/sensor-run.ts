import type {
  Diagnosis,
  PolicyRule,
  SensorExclusion,
  SensorFindings,
  SuiteResult,
  UnknownFiles,
} from "@recognizer/core";
import {
  type Config,
  complexityUnmeasured,
  duplicationUnmeasured,
  type FindingEntry,
  InputError,
  parseConfig,
  parsePolicy,
  readSensorFindings,
  registeredSensors,
  resolveStructureSettings,
} from "recognizer";
import {
  type Refusal,
  type RunRecordFiles,
  refusalsOf,
} from "./refusal-record";
import { type PlannedWork, scanHistory } from "./scan-estimate";
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
  suites?: readonly SuiteResult[];
};

export type FindingsFiles = {
  files: { name: string; text: string; modifiedMs: number | null }[];
  refused: string[];
};

export type OverlayFiles = {
  files: { name: string; text: string; modifiedMs: number | null }[];
  refused: string[];
};

export type SensorInputs = {
  policy: string | null;
  config: string | null;
  baseline: string | null;
  refused: string[];
  analysis: boolean;
};

export type ShippedSensor = {
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
  metrics: ShippedMetric[];
  findings: FindingEntry[];
  settings: ShippedSetting[];
};

export type ShippedMetric = {
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

export type ShippedSetting = {
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
      source: "config" | "shipped";
    }
  | { status: "unavailable"; reason: string };

export type ShippedSensors =
  | { status: "ok"; sensors: ShippedSensor[] }
  | { status: "unavailable"; reason: string };

export type WorkRequest = {
  sensor: string;
  modules: string[] | null;
  suites: string[] | null;
};

export type SensorsPort = {
  readFindings(): Promise<FindingsFiles>;
  readOverlays(): Promise<OverlayFiles>;
  readRunRecords(): Promise<RunRecordFiles>;
  readTestsHash(known: Record<string, string>): Promise<string | null>;
  removeFindings(names: string[]): Promise<void>;
  readInputs(): Promise<SensorInputs>;
  onInputsChanged(run: () => void): () => void;
  watchInputs(): Promise<void>;
  shipped(): Promise<ShippedSensors>;
  describer(): Promise<DescriberInEffect>;
  plannedWork(request: WorkRequest): Promise<PlannedWork | null>;
};

export const inertSensors: SensorsPort = {
  readFindings: async () => ({ files: [], refused: [] }),
  readOverlays: async () => ({ files: [], refused: [] }),
  readRunRecords: async () => ({ files: [], refused: [] }),
  readTestsHash: async () => null,
  removeFindings: async () => {},
  readInputs: async () => ({
    policy: null,
    config: null,
    baseline: null,
    refused: [],
    analysis: true,
  }),
  onInputsChanged: () => () => {},
  watchInputs: async () => {},
  shipped: async () => ({
    status: "unavailable",
    reason: "the shipped sensors are not available",
  }),
  describer: async () => ({
    status: "unavailable",
    reason: "the describer is not available",
  }),
  plannedWork: async () => null,
};

export type SensorRun = {
  documents: SensorFindings[];
  statuses: SensorStatus[];
};

export { scansCommit };

function messagesOf(error: unknown): string {
  return error instanceof InputError
    ? error.messages.join("; ")
    : (error as Error).message;
}

function readConfig(
  text: string | null,
  statuses: SensorStatus[],
): Config | null {
  if (text === null) {
    return null;
  }

  try {
    return parseConfig(text);
  } catch (error) {
    statuses.push({
      name: "config.yaml",
      status: "failed",
      reason: messagesOf(error),
    });

    return null;
  }
}

function readPolicy(
  text: string | null,
  statuses: SensorStatus[],
): PolicyRule[] | null {
  if (text === null) {
    return null;
  }

  try {
    return parsePolicy(text);
  } catch (error) {
    statuses.push({
      name: "policy.yaml",
      status: "failed",
      reason: messagesOf(error),
    });

    return null;
  }
}

export async function senseRepository(
  _scans: LoadedScan[],
  inputs: Pick<SensorInputs, "policy" | "config"> & { analysis?: boolean },
  port: SensorsPort,
): Promise<SensorRun> {
  const statuses: SensorStatus[] = [];
  const config = readConfig(inputs.config, statuses);
  readPolicy(inputs.policy, statuses);
  const settings = resolveStructureSettings(config);
  const documents: SensorFindings[] = [];
  const read = await port.readFindings();
  let structure: SensorFindings | null = null;
  let structureRan = false;

  if (settings === "off") {
    statuses.push({ name: "structure", status: "off" });
  } else {
    const file = read.files.find(({ name }) => name === "structure");

    if (file === undefined) {
      statuses.push({ name: "structure", status: "not run" });
    } else {
      try {
        const stored = readSensorFindings(JSON.parse(file.text), {
          name: "structure",
        });
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

  const failed: string[] = [];
  const registered = registeredSensors(config).map(({ name }) => name);

  for (const name of read.refused) {
    failed.push(name);
    statuses.push({ name, status: "failed", reason: "could not be read" });
  }

  for (const file of read.files) {
    if (file.name === "structure") {
      continue;
    }

    try {
      const document = readSensorFindings(JSON.parse(file.text), {
        name: file.name,
      });

      documents.push(document);
      statuses.push({
        name: file.name,
        status: "ran",
        measured: {
          ...(document.inputs !== undefined ? { inputs: document.inputs } : {}),
          ...(document.tests !== undefined ? { tests: document.tests } : {}),
        },
        findings: document.findings.length,
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
        ...(document.suites !== undefined ? { suites: document.suites } : {}),
        ...(document.reportedAt !== undefined && !registered.includes(file.name)
          ? { reported: { at: document.reportedAt, commit: document.commit } }
          : {}),
      });
    } catch (error) {
      failed.push(file.name);
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

  if (failed.length > 0) {
    await port.removeFindings(failed);
  }

  for (const name of registered) {
    if (!statuses.some((status) => status.name === name)) {
      statuses.push({ name, status: "not run" });
    }
  }

  return {
    documents,
    statuses,
  };
}

function registeredNames(config: string | null): string[] {
  if (config === null) {
    return [];
  }

  try {
    return registeredSensors(parseConfig(config)).map(({ name }) => name);
  } catch {
    return [];
  }
}

export async function withSensors(
  loaded: Loaded,
  port: SensorsPort,
): Promise<Loaded> {
  const inputs = await port.readInputs();
  const run = await senseRepository(loaded.scans, inputs, port);
  const overlays = await port.readOverlays();
  const tests = await port.readTestsHash({}).catch(() => null);
  const records = await port
    .readRunRecords()
    .catch((): RunRecordFiles => ({ files: [], refused: [] }));
  const refusals = refusalsOf(
    records.files,
    registeredNames(inputs.config),
    run.statuses,
  );

  return {
    ...loaded,
    policy: inputs.policy,
    baseline: inputs.baseline,
    findings: run.documents,
    sensors: run.statuses.map((status) =>
      status.status !== "failed" && refusals[status.name] !== undefined
        ? { ...status, refusal: refusals[status.name] }
        : status,
    ),
    overlays: overlays.files,
    overlaysUnreadable: overlays.refused,
    tests,
    history: scanHistory(records.files),
  };
}
