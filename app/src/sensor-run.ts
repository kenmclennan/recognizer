import {
  type Config,
  type Diagnosis,
  type FindingsDocument,
  InputError,
  type Policy,
  parseConfig,
  parsePolicy,
  registeredSensors,
  resolveStructureSettings,
  type Scan,
  scanHashes,
  structureSensor,
  validateFindings,
} from "recognizer";
import {
  type Refusal,
  type RunRecordFiles,
  refusalsOf,
} from "./refusal-record";
import type { Loaded, LoadedScan } from "./scan-loading";

export type SensorStatus = {
  name: string;
  status: "ran" | "failed" | "off" | "stale" | "not run";
  reason?: string;
  findings?: number;
  modifiedMs?: number | null;
  reported?: { at: string; commit: string };
  commit?: string;
  stopped?: { measured: number; total: number };
  partial?: { measured: number; total: number };
  excluded?: { functions: number; modules: string[] };
  unowned?: { functions: number; modules: string[] };
  diagnosis?: Diagnosis;
  refusal?: Refusal;
  measured?: { inputs?: Record<string, string>; tests?: string };
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
};

export type ShippedSensor = {
  name: string;
  display: string;
  line: string;
  defaults: Record<string, number | boolean | string>;
  runsTests: boolean;
  listed: boolean;
  metrics?: ShippedMetric[];
};

export type ShippedMetric = {
  name: string;
  type: "ratio" | "count" | "number" | "boolean";
  granularity: "module" | "member";
  bad: "high" | "low";
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

export type SensorsPort = {
  writeStructure(document: string | null): Promise<void>;
  readFindings(): Promise<FindingsFiles>;
  readOverlays(): Promise<OverlayFiles>;
  readRunRecords(): Promise<RunRecordFiles>;
  readTestsHash(known: Record<string, string>): Promise<string | null>;
  removeFindings(names: string[]): Promise<void>;
  readInputs(): Promise<SensorInputs>;
  onInputsChanged(run: () => void): () => void;
  shipped(): Promise<ShippedSensors>;
  describer(): Promise<DescriberInEffect>;
};

export const inertSensors: SensorsPort = {
  writeStructure: async () => {},
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
  }),
  onInputsChanged: () => () => {},
  shipped: async () => ({
    status: "unavailable",
    reason: "the shipped sensors are not available",
  }),
  describer: async () => ({
    status: "unavailable",
    reason: "the describer is not available",
  }),
};

export type SensorRun = {
  documents: FindingsDocument[];
  statuses: SensorStatus[];
};

type RecordedScan = Scan & {
  commit?: string | null;
  modified?: boolean | null;
};

export function scansCommit(scans: Scan[]): {
  commit: string | null;
  modified: boolean;
} {
  const recorded = scans as RecordedScan[];

  return {
    commit: recorded[0]?.commit ?? null,
    modified: recorded.some((scan) => scan.modified !== false),
  };
}

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
): Policy | null {
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
  scans: LoadedScan[],
  inputs: Pick<SensorInputs, "policy" | "config">,
  port: SensorsPort,
): Promise<SensorRun> {
  const statuses: SensorStatus[] = [];
  const config = readConfig(inputs.config, statuses);
  const policy = readPolicy(inputs.policy, statuses);
  const plain = scans.map(({ scan }) => scan);
  const { commit, modified } = scansCommit(plain);
  const settings = resolveStructureSettings(config);
  const documents: FindingsDocument[] = [];
  let structure: FindingsDocument | null = null;
  let structureRan = false;

  if (settings === "off") {
    await port.writeStructure(null);
    statuses.push({ name: "structure", status: "off" });
  } else {
    const context = { commit: commit ?? "", modified };

    try {
      const sensed = structureSensor(plain, policy, settings, context);

      structure = sensed.document;
    } catch (error) {
      statuses.push({
        name: "policy.yaml",
        status: "failed",
        reason: messagesOf(error),
      });
      const sensed = structureSensor(plain, null, settings, context);

      structure = sensed.document;
    }

    try {
      await port.writeStructure(
        commit === null ? null : `${JSON.stringify(structure, null, 2)}\n`,
      );
      statuses.push({ name: "structure", status: "ran" });
      structureRan = true;
    } catch (error) {
      statuses.push({
        name: "structure",
        status: "failed",
        reason: String(error),
      });
    }
  }

  const read = await port.readFindings();
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
      const document = validateFindings(JSON.parse(file.text), {
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
        ...(document.reported_at !== undefined &&
        !registered.includes(file.name)
          ? { reported: { at: document.reported_at, commit: document.commit } }
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
  const known = Object.fromEntries(
    scanHashes(loaded.scans.map(({ scan }) => scan)),
  );
  const tests = await port.readTestsHash(known).catch(() => null);
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
  };
}
