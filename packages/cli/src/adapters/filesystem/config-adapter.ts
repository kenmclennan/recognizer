import type {
  ConfigDocument,
  ConfigRepository,
  StructureSettings,
  SuiteEntry,
} from "@recognizer/core";
import { parse } from "yaml";
import type { Io } from "../../cli.js";
import { configFile, readConfig } from "../../config.js";
import {
  type Config,
  type ConfigRead,
  readsAnyConfig,
  readsSensors,
  registeredSensors,
} from "../../config-parse.js";
import { resolveStructureSettings } from "../../structure-sensor.js";

export class ConfigAdapter implements ConfigRepository {
  constructor(
    private readonly io: Io,
    private readonly read: ConfigRead,
  ) {}

  scannerSetup(root: string): {
    scanners: Record<string, string>;
    install: Record<string, string>;
  } {
    const registered = readConfig(this.io, root, ["scanners", "install"]);

    return {
      scanners: registered?.scanners ?? {},
      install: registered?.install ?? {},
    };
  }

  run(root: string, skipRetired: boolean): ConfigDocument | null {
    return (readsAnyConfig(this.read)
      ? readConfig(this.io, root, this.read, { skipRetired })
      : null) as unknown as ConfigDocument | null;
  }

  analysis(root: string, skipRetired: boolean): ConfigDocument | null {
    return readConfig(this.io, root, ["sensors"], {
      skipRetired,
    }) as unknown as ConfigDocument | null;
  }

  readsSensorConfig(): boolean {
    return readsSensors(this.read);
  }

  structureSettings(root: string): StructureSettings | "off" {
    return resolveStructureSettings(readConfig(this.io, root, ["sensors"]));
  }

  registeredSensors(
    config: ConfigDocument | null,
  ): { name: string; command: string[] }[] {
    return registeredSensors(config as unknown as Config | null);
  }

  tests(config: ConfigDocument | null): SuiteEntry[] | undefined {
    return (config as unknown as Config | null)?.tests;
  }

  sensorConfig(root: string): ConfigDocument | null {
    return readConfig(this.io, root, [
      "sensors",
      "tests",
    ]) as unknown as ConfigDocument | null;
  }

  sensorNames(root: string): string[] {
    return registeredSensors(readConfig(this.io, root, ["sensors"])).map(
      ({ name }) => name,
    );
  }

  setupDocument(root: string): {
    present: boolean;
    document: Record<string, unknown>;
  } {
    const file = configFile(root);

    if (!this.io.exists(file)) {
      return { present: false, document: {} };
    }

    try {
      const value: unknown = parse(this.io.readFile(file));

      return {
        present: true,
        document:
          typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {},
      };
    } catch {
      return { present: true, document: {} };
    }
  }
}
