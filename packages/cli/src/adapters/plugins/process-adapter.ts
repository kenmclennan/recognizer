import type {
  InstalledPlugin,
  PluginLimits,
  ProcessControl,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { createPluginLimits } from "../../plugin-run.js";
import { processScope } from "../../stop-scope.js";

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
    return (this.io.scope ?? processScope).stop();
  }
}
