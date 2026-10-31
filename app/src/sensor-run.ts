import {
  type Config,
  type FindingsDocument,
  InputError,
  type Policy,
  parseConfig,
  parsePolicy,
  registeredSensors,
  resolveStructureSettings,
  type Scan,
  structureSensor,
  validateFindings,
} from "recognizer";
import type { Loaded, LoadedScan } from "./scan-loading";

export type SensorStatus = {
  name: string;
  status: "ran" | "failed" | "off" | "stale" | "not run";
  reason?: string;
};

export type FindingsFiles = {
  files: { name: string; text: string }[];
  refused: string[];
};

export type SensorInputs = {
  policy: string | null;
  config: string | null;
  baseline: string | null;
  refused: string[];
};

export type SensorsRunResult =
  | {
      status: "sensed";
      sensors: { name: string; status: "ran" | "failed"; reason?: string }[];
    }
  | { status: "command-missing"; hint: string }
  | { status: "failed"; reason: string };

export type SensorsPort = {
  writeStructure(document: string | null): Promise<void>;
  readFindings(): Promise<FindingsFiles>;
  removeFindings(names: string[]): Promise<void>;
  readInputs(): Promise<SensorInputs>;
  run(names: string[]): Promise<SensorsRunResult>;
  onInputsChanged(run: () => void): () => void;
};

export const inertSensors: SensorsPort = {
  writeStructure: async () => {},
  readFindings: async () => ({ files: [], refused: [] }),
  removeFindings: async () => {},
  readInputs: async () => ({
    policy: null,
    config: null,
    baseline: null,
    refused: [],
  }),
  run: async () => ({ status: "sensed", sensors: [] }),
  onInputsChanged: () => () => {},
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
      structure = structureSensor(plain, policy, settings, context).document;
    } catch (error) {
      statuses.push({
        name: "policy.yaml",
        status: "failed",
        reason: messagesOf(error),
      });
      structure = structureSensor(plain, null, settings, context).document;
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
        status: document.commit === commit ? "ran" : "stale",
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

  for (const { name } of registeredSensors(config)) {
    if (!statuses.some((status) => status.name === name)) {
      statuses.push({ name, status: "not run" });
    }
  }

  return { documents, statuses };
}

export async function withSensors(
  loaded: Loaded,
  port: SensorsPort,
): Promise<Loaded> {
  const inputs = await port.readInputs();
  const run = await senseRepository(loaded.scans, inputs, port);

  return {
    ...loaded,
    policy: inputs.policy,
    baseline: inputs.baseline,
    findings: run.documents,
    sensors: run.statuses,
  };
}
