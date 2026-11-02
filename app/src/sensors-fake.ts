import type {
  FindingsFiles,
  OverlayFiles,
  SensorInputs,
  SensorsPort,
  ShippedSensor,
  ShippedSensors,
} from "./sensor-run";

export function withSensorEntry(
  config: string | null,
  name: string,
  add: boolean,
): string | null {
  const lines = (config ?? "").split("\n").filter((line) => line !== "");
  const entry = `  ${name}: {}`;

  if (add) {
    const at = lines.indexOf("sensors:");

    return at === -1
      ? [...lines, "sensors:", entry, ""].join("\n")
      : [...lines.slice(0, at + 1), entry, ...lines.slice(at + 1), ""].join(
          "\n",
        );
  }

  const kept = lines.filter((line) => line !== entry);
  const empty = !kept.some((line, at) => at > 0 && line.startsWith("  "));

  return (empty ? kept.filter((line) => line !== "sensors:") : kept)
    .concat("")
    .join("\n");
}

export type FakeSensors = SensorsPort & {
  files: Map<string, string>;
  inputs: SensorInputs;
  refused: string[];
  overlays: Map<string, string>;
  overlaysRefused: string[];
  removed: string[];
  written: (string | null)[];
  failWrite: boolean;
  failEdit: boolean;
  list: ShippedSensors;
  edits: { name: string; add: boolean }[];
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
    overlaysRefused: [],
    removed: [],
    written: [],
    failWrite: false,
    failEdit: false,
    list: Array.isArray(shipped) ? { status: "ok", sensors: shipped } : shipped,
    edits: [],
    async shipped() {
      return fake.list;
    },
    async edit(name, add) {
      fake.edits.push({ name, add });

      if (fake.failEdit) {
        throw new Error("config.yaml is read-only");
      }

      if (
        fake.list.status !== "ok" ||
        !fake.list.sensors.some((one) => one.name === name)
      ) {
        throw new Error(`${name} is not a shipped sensor`);
      }

      fake.inputs = {
        ...fake.inputs,
        config: withSensorEntry(fake.inputs.config, name, add),
      };

      if (!add) {
        fake.files.delete(name);
      }

      for (const run of listeners) {
        run();
      }
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
        files: [...fake.files].map(([name, text]) => ({ name, text })),
        refused: fake.refused,
      };
    },
    async readOverlays(): Promise<OverlayFiles> {
      return {
        files: [...fake.overlays].map(([name, text]) => ({ name, text })),
        refused: fake.overlaysRefused,
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
    editInputs(next) {
      fake.inputs = { ...fake.inputs, ...next };

      for (const run of listeners) {
        run();
      }
    },
  };

  return fake;
}
