import type { ConfigDocument } from "./config-document.js";
import type { StructureSettings } from "./structure-settings.js";

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
}
