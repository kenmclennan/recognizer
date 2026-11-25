import { describerVersion, parseConfig } from "recognizer";
import type { RunRecordFiles } from "./refusal-record";
import type { PlannedWork } from "./scan-estimate";
import type {
  InstalledSensor,
  InstalledSensors,
  SensorInputs,
  SensorsPort,
  StoredResults,
  WorkRequest,
} from "./sensor-run";

export type FakeSensors = SensorsPort & {
  files: Map<string, string>;
  inputs: SensorInputs;
  refused: string[];
  overlays: Map<string, string>;
  modifiedOverlays: Map<string, number>;
  overlaysRefused: string[];
  runRecords: Map<string, string>;
  runRecordsRefused: string[];
  testsHash: string | null;
  removed: string[];
  list: InstalledSensors;
  modified: Map<string, number>;
  work: Map<string, PlannedWork | null>;
  workRequests: WorkRequest[];
  holdWork: boolean;
  releaseWork(): void;
  editInputs(inputs: Partial<SensorInputs>): void;
};

export function fakeSensors(
  files: Record<string, string> = {},
  inputs: Partial<SensorInputs> = {},
  overlays: Record<string, string> = {},
  installed: InstalledSensors | InstalledSensor[] = [],
): FakeSensors {
  const listed: InstalledSensor[] = Array.isArray(installed)
    ? installed
    : installed.status === "ok"
      ? installed.sensors
      : [];
  const registersEverything = [
    "describer:\n  command: [describer]\n  version: v1",
    "sensors:",
    ...listed.map(({ name }) => `  ${name}: {}`),
  ].join("\n");
  const held: (() => void)[] = [];
  const fake: FakeSensors = {
    files: new Map(Object.entries(files)),
    inputs: {
      policy: null,
      config: listed.length === 0 ? null : `${registersEverything}\n`,
      baseline: null,
      refused: [],
      analysis: true,
      ...inputs,
    },
    refused: [],
    overlays: new Map(Object.entries(overlays)),
    modifiedOverlays: new Map(),
    overlaysRefused: [],
    runRecords: new Map(),
    runRecordsRefused: [],
    testsHash: null,
    removed: [],
    list: Array.isArray(installed)
      ? { status: "ok", sensors: installed }
      : installed,
    modified: new Map(),
    work: new Map(),
    workRequests: [],
    holdWork: false,
    releaseWork() {
      fake.holdWork = false;

      for (const release of held.splice(0)) {
        release();
      }
    },
    async plannedWork(request) {
      fake.workRequests.push(request);

      if (fake.holdWork) {
        await new Promise<void>((release) => held.push(release));
      }

      return fake.work.get(request.sensor) ?? null;
    },
    async describer() {
      let configured: { command: string[]; version: string } | undefined;

      try {
        configured =
          fake.inputs.config === null
            ? undefined
            : parseConfig(fake.inputs.config).describer;
      } catch {
        configured = undefined;
      }

      if (configured === undefined) {
        return { status: "unavailable", reason: "no describer is registered" };
      }

      return {
        status: "ok",
        ...configured,
        version: describerVersion(configured),
      };
    },
    async sensorList() {
      return fake.list;
    },
    async readResults(): Promise<StoredResults> {
      return {
        findings: {
          files: [...fake.files].map(([name, text]) => ({
            name,
            text,
            modifiedMs: fake.modified.get(name) ?? null,
          })),
          refused: fake.refused,
        },
        overlays: {
          files: [...fake.overlays].map(([name, text]) => ({
            name,
            text,
            modifiedMs: fake.modifiedOverlays.get(name) ?? null,
          })),
          refused: fake.overlaysRefused,
        },
      };
    },
    async readRunRecords(): Promise<RunRecordFiles> {
      return {
        files: [...fake.runRecords]
          .map(([name, text]) => ({ name, text }))
          .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)),
        refused: fake.runRecordsRefused,
      };
    },
    async readTestsHash() {
      return fake.testsHash;
    },
    async clearResults(name) {
      fake.removed.push(name);
      fake.files.delete(name);
      fake.overlays.delete(name);
    },
    async readInputs() {
      return fake.inputs;
    },
    editInputs(next) {
      fake.inputs = { ...fake.inputs, ...next };
    },
  };

  return fake;
}
