import {
  describerVersion,
  parseConfig,
  SHIPPED_DESCRIBER_COMMAND,
} from "recognizer";
import type { RunRecordFiles } from "./refusal-record";
import type {
  FindingsFiles,
  OverlayFiles,
  SensorInputs,
  SensorsPort,
  ShippedSensor,
  ShippedSensors,
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
  written: (string | null)[];
  failWrite: boolean;
  list: ShippedSensors;
  modified: Map<string, number>;
  shippedVersion: string | null;
  editInputs(inputs: Partial<SensorInputs>): void;
};

export function fakeSensors(
  files: Record<string, string> = {},
  inputs: Partial<SensorInputs> = {},
  overlays: Record<string, string> = {},
  shipped: ShippedSensors | ShippedSensor[] = [],
): FakeSensors {
  const listeners = new Set<() => void>();
  const fake: FakeSensors = {
    files: new Map(Object.entries(files)),
    inputs: {
      policy: null,
      config: null,
      baseline: null,
      refused: [],
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
    written: [],
    failWrite: false,
    list: Array.isArray(shipped) ? { status: "ok", sensors: shipped } : shipped,
    modified: new Map(),
    shippedVersion: "prompt-0123456789ab",
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

      if (configured !== undefined) {
        return {
          status: "ok",
          ...configured,
          version: describerVersion(configured),
          source: "config",
        };
      }

      return fake.shippedVersion === null
        ? {
            status: "unavailable",
            reason:
              "no describer is registered and recognizer-describe-claude is not installed",
          }
        : {
            status: "ok",
            command: [...SHIPPED_DESCRIBER_COMMAND],
            version: describerVersion({
              command: [...SHIPPED_DESCRIBER_COMMAND],
              version: fake.shippedVersion,
            }),
            source: "shipped",
          };
    },
    async shipped() {
      return fake.list;
    },
    async writeStructure(document) {
      if (fake.failWrite) {
        throw new Error("disk full");
      }

      fake.written.push(document);

      if (document === null) {
        fake.files.delete("structure");
      } else {
        fake.files.set("structure", document);
      }
    },
    async readFindings(): Promise<FindingsFiles> {
      return {
        files: [...fake.files].map(([name, text]) => ({
          name,
          text,
          modifiedMs: fake.modified.get(name) ?? null,
        })),
        refused: fake.refused,
      };
    },
    async readOverlays(): Promise<OverlayFiles> {
      return {
        files: [...fake.overlays].map(([name, text]) => ({
          name,
          text,
          modifiedMs: fake.modifiedOverlays.get(name) ?? null,
        })),
        refused: fake.overlaysRefused,
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
    async removeFindings(names) {
      fake.removed.push(...names);

      for (const name of names) {
        fake.files.delete(name);
      }
    },
    async readInputs() {
      return fake.inputs;
    },
    onInputsChanged(run) {
      listeners.add(run);

      return () => listeners.delete(run);
    },
    editInputs(next) {
      fake.inputs = { ...fake.inputs, ...next };

      for (const run of listeners) {
        run();
      }
    },
  };

  return fake;
}
