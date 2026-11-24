import type {
  ConfigRegistration,
  Found,
} from "../../../domain/plugins/doctor-report.js";
import type { InstalledPlugin } from "../../../domain/plugins/installed-plugin.js";

export interface ConfigReading {
  problems: Found[];
  registered: ConfigRegistration;
}

export interface RepositoryChecks {
  isDirectory(root: string): boolean;
  languages(root: string, scanners: readonly InstalledPlugin[]): string[];
  config(root: string, named: boolean): ConfigReading;
  policy(root: string, named: boolean, languages: string[]): Found[];
  registeredSensors(root: string): { name: string; command: string[] }[];
  suites(root: string): readonly unknown[] | undefined;
}
