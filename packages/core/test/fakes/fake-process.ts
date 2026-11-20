import type { PluginLimits, ProcessControl } from "../../src/index.js";

export class FakeProcess implements ProcessControl {
  stops = 0;
  private readonly releases: (() => void)[] = [];

  limits(): PluginLimits {
    return { pluginLimits: true };
  }

  onStop(release: () => void): void {
    this.releases.push(release);
  }

  stopAll(): Promise<void> {
    this.stops += 1;

    for (const release of this.releases.splice(0)) {
      release();
    }

    return Promise.resolve();
  }
}
