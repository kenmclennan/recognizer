import type { PluginLimits, ProcessControl } from "@recognizer/core";
import { type Io, stopEverything } from "../../cli.js";
import type { InstalledPlugin } from "../../plugin-discovery.js";
import { createPluginLimits } from "../../plugin-run.js";

export class ProcessAdapter implements ProcessControl {
  constructor(
    private readonly io: Io,
    private readonly plugins: () => InstalledPlugin[],
  ) {}

  limits(root: string): PluginLimits {
    return createPluginLimits(
      this.io,
      root,
      undefined,
      this.plugins(),
    ) as unknown as PluginLimits;
  }

  stopAll(): Promise<void> {
    return stopEverything();
  }
}
