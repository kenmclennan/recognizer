import type { ConfigDocument } from "./config-document.js";
import type { RepositoryText } from "./repository-text.js";
import type { StructureSettings } from "./structure-settings.js";

export interface SuiteEntry {
  name: string;
  language: string;
}

export interface ConfigRepository {
  scannerSetup(root: string): {
    scanners: Record<string, string>;
    install: Record<string, string>;
  };
  run(root: string, skipRetired: boolean): ConfigDocument | null;
  analysis(root: string, skipRetired: boolean): ConfigDocument | null;
  readsSensorConfig(): boolean;
  structureSettings(root: string): StructureSettings | "off";
  sensorNames(root: string): string[];
  registeredSensors(
    config: ConfigDocument | null,
  ): { name: string; command: string[] }[];
  tests(config: ConfigDocument | null): SuiteEntry[] | undefined;
  sensorConfig(root: string): ConfigDocument | null;
  text(root: string): RepositoryText;
  saveText(root: string, text: string): void;
  setupDocument(root: string): {
    present: boolean;
    document: Record<string, unknown>;
  };
}
