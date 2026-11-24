import type {
  ConfigDocument,
  ConfigRepository,
  DescriberBuild,
  RepositoryText,
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
  registeredSensorNamesIn,
  registeredSensors,
} from "../../config-parse.js";
import { resolveStructureSettings } from "../../structure-sensor.js";
import { readRepositoryText, saveRepositoryText } from "./repository-text.js";

export class ConfigAdapter implements ConfigRepository {
  constructor(
    private readonly io: Io,
    private readonly read: ConfigRead,
  ) {}

  scannerSetup(root: string): {
    scanners: Record<string, string>;
    install: Record<string, string>;
    describerBuild: DescriberBuild | null;
  } {
    const registered = readConfig(this.io, root, ["scanners", "install"]);

    return {
      scanners: registered?.scanners ?? {},
      install: registered?.install ?? {},
      describerBuild: this.describerBuild(root),
    };
  }

  private describerBuild(root: string): DescriberBuild | null {
    try {
      return readConfig(this.io, root, ["describer"])?.describer?.build ?? null;
    } catch {
      return null;
    }
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
  ): { name: string; command: string[]; manifest?: string[] }[] {
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

  sensorNamesDespiteErrors(root: string): string[] {
    const file = configFile(root);

    return this.io.exists(file)
      ? registeredSensorNamesIn(this.io.readFile(file))
      : [];
  }

  text(root: string): RepositoryText {
    return readRepositoryText(this.io, configFile(root));
  }

  saveText(root: string, text: string): void {
    saveRepositoryText(this.io, configFile(root), text);
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
