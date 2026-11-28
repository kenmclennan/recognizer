import { createHash } from "node:crypto";
import {
  type ConfigDocument,
  type ConfigRepository,
  DEFAULT_STRUCTURE_SETTINGS,
  type DescriberBuild,
  type RepositoryText,
  type StructureSettings,
  type SuiteEntry,
} from "../../src/index.js";
import type { FakeSensors } from "./fake-sensors.js";

const DOCUMENT = {} as ConfigDocument;

export class FakeConfigRepository implements ConfigRepository {
  present = true;
  settings: StructureSettings | "off" = DEFAULT_STRUCTURE_SETTINGS;
  sensorSettingsByName: Record<string, Record<string, unknown>> = {};
  failSensorConfig: string | null = null;

  constructor(private readonly invented: FakeSensors) {}

  scannerSetup(): {
    scanners: Record<string, string>;
    describerBuild: DescriberBuild | null;
  } {
    return { scanners: {}, describerBuild: null };
  }

  run(): ConfigDocument | null {
    return this.document();
  }

  analysis(): ConfigDocument | null {
    return this.document();
  }

  sensorConfig(): ConfigDocument | null {
    if (this.failSensorConfig !== null) {
      throw new Error(this.failSensorConfig);
    }

    return this.document();
  }

  sensorSettings(
    config: ConfigDocument | null,
    name: string,
  ): Record<string, unknown> {
    return config === null ? {} : (this.sensorSettingsByName[name] ?? {});
  }

  tests(config: ConfigDocument | null): SuiteEntry[] | undefined {
    return config === null || this.invented.suites.length === 0
      ? undefined
      : this.invented.suites.map((name) => ({ name, language: "python" }));
  }

  held: string | null = null;
  saves: string[] = [];
  failText = false;

  text(): RepositoryText {
    if (this.failText) {
      throw new Error("the config cannot be read");
    }

    const text = this.held ?? "";

    return {
      present: this.held !== null,
      text,
      hash: createHash("sha256").update(text, "utf8").digest("hex"),
    };
  }

  saveText(_root: string, text: string): void {
    this.held = text;
    this.saves.push(text);
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
}
