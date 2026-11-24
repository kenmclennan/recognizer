import {
  type ConfigDocument,
  type ConfigRepository,
  DEFAULT_STRUCTURE_SETTINGS,
  type StructureSettings,
  type SuiteEntry,
  shippedCommand,
} from "../../src/index.js";
import type { FakeSensors } from "./fake-sensors.js";

const DOCUMENT = {} as ConfigDocument;

export class FakeConfigRepository implements ConfigRepository {
  present = true;
  unshipped: string[] = [];
  settings: StructureSettings | "off" = DEFAULT_STRUCTURE_SETTINGS;
  sensors: string[] = [];

  constructor(private readonly invented: FakeSensors) {}

  scannerSetup(): {
    scanners: Record<string, string>;
    install: Record<string, string>;
  } {
    return { scanners: {}, install: {} };
  }

  run(): ConfigDocument | null {
    return this.document();
  }

  analysis(): ConfigDocument | null {
    return this.document();
  }

  sensorConfig(): ConfigDocument | null {
    return this.document();
  }

  registeredSensors(
    config: ConfigDocument | null,
  ): { name: string; command: string[] }[] {
    return config === null
      ? []
      : [
          ...[...this.invented.installed.values()]
            .filter((sensor) => sensor.registered ?? true)
            .map((sensor) => ({
              name: sensor.name,
              command: shippedCommand(sensor.name, {}),
            })),
          ...this.unshipped.map((name) => ({ name, command: [name] })),
        ];
  }

  tests(config: ConfigDocument | null): SuiteEntry[] | undefined {
    return config === null || this.invented.suites.length === 0
      ? undefined
      : this.invented.suites.map((name) => ({ name, language: "python" }));
  }

  setup: Record<string, unknown> = {};

  setupDocument(): { present: boolean; document: Record<string, unknown> } {
    return { present: this.present, document: this.setup };
  }

  private document(): ConfigDocument | null {
    return this.present ? DOCUMENT : null;
  }

  readsSensorConfig(): boolean {
    return false;
  }

  structureSettings(): StructureSettings | "off" {
    return this.settings;
  }

  sensorNames(): string[] {
    return [...this.sensors];
  }
}
