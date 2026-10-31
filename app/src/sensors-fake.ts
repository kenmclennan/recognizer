import { parseConfig, registeredSensors } from "recognizer";
import type {
  FindingsFiles,
  SensorInputs,
  SensorsPort,
  SensorsRunResult,
} from "./sensor-run";

export type FakeSensors = SensorsPort & {
  files: Map<string, string>;
  inputs: SensorInputs;
  refused: string[];
  removed: string[];
  written: (string | null)[];
  failWrite: boolean;
  ran: string[][];
  plan: Record<string, string>;
  gate: Promise<void> | null;
  commit: string;
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
    ran: [],
    plan: {},
    gate: null,
    commit: "abc1234",
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
    async run(names): Promise<SensorsRunResult> {
      fake.ran.push(names);

      let registered: string[];

      try {
        registered = registeredSensors(
          fake.inputs.config === null ? null : parseConfig(fake.inputs.config),
        ).map(({ name }) => name);
      } catch {
        registered = [];
      }

      const unknown = names.filter((name) => !registered.includes(name));

      if (names.length === 0 || unknown.length > 0) {
        return {
          status: "failed",
          reason:
            names.length === 0
              ? "no sensor was named"
              : `no such sensor: ${unknown.join(", ")}`,
        };
      }

      if (fake.gate !== null) {
        await fake.gate;
      }

      return {
        status: "sensed",
        sensors: names.map((name) => {
          const outcome = fake.plan[name] ?? "ran";

          if (outcome === "ran") {
            fake.files.set(name, findingsFor(name, fake.commit));

            return { name, status: "ran" as const };
          }

          fake.files.delete(name);

          return { name, status: "failed" as const, reason: outcome };
        }),
      };
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

function findingsFor(name: string, commit: string): string {
  return JSON.stringify({
    findings_version: 1,
    sensor: { name, version: "1" },
    commit,
    modified: false,
    settings: {},
    findings: [],
  });
}
