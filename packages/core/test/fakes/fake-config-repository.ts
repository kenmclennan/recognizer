import {
  type ConfigDocument,
  type ConfigRepository,
  DEFAULT_STRUCTURE_SETTINGS,
  type StructureSettings,
} from "../../src/index.js";

export class FakeConfigRepository implements ConfigRepository {
  settings: StructureSettings | "off" = DEFAULT_STRUCTURE_SETTINGS;
  sensors: string[] = [];

  scannerSetup(): {
    scanners: Record<string, string>;
    install: Record<string, string>;
  } {
    return { scanners: {}, install: {} };
  }

  run(): ConfigDocument | null {
    return null;
  }

  analysis(): ConfigDocument | null {
    return null;
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
