import type { FindingsFiles, SensorInputs, SensorsPort } from "./sensor-run";

export type FakeSensors = SensorsPort & {
  files: Map<string, string>;
  inputs: SensorInputs;
  refused: string[];
  removed: string[];
  written: (string | null)[];
  failWrite: boolean;
  edit(inputs: Partial<SensorInputs>): void;
};

export function fakeSensors(
  files: Record<string, string> = {},
  inputs: Partial<SensorInputs> = {},
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
    removed: [],
    written: [],
    failWrite: false,
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
        files: [...fake.files].map(([name, text]) => ({ name, text })),
        refused: fake.refused,
      };
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
    edit(next) {
      fake.inputs = { ...fake.inputs, ...next };

      for (const run of listeners) {
        run();
      }
    },
  };

  return fake;
}
