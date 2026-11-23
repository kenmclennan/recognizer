import type { ShippedPlugins } from "../../src/index.js";

export class FakeShippedPlugins implements ShippedPlugins {
  sensorNames: string[] = [];
  describerNames: string[] = [];
  scannerNames: string[] = [];

  sensors(): string[] {
    return [...this.sensorNames];
  }

  describers(): string[] {
    return [...this.describerNames];
  }

  scanners(): string[] {
    return [...this.scannerNames];
  }
}
