import type { ConfigDocument, ConfigRepository } from "../../src/index.js";

export class FakeConfigRepository implements ConfigRepository {
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
}
