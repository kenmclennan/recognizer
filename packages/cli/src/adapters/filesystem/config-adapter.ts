import type { ConfigDocument, ConfigRepository } from "@recognizer/core";
import type { Io } from "../../cli.js";
import { readConfig } from "../../config.js";
import {
  type ConfigRead,
  readsAnyConfig,
  readsSensors,
} from "../../config-parse.js";

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
}
