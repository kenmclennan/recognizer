import type { FreshPorts } from "@recognizer/core";
import { BaselineAdapter } from "./adapters/filesystem/baseline-adapter.js";
import type { Io } from "./cli.js";
import type { ConfigRead } from "./config-parse.js";
import { syncScanPorts } from "./scan-container.js";
import { printEvent } from "./scan-wire.js";

export function freshPorts(io: Io, read: ConfigRead): FreshPorts {
  const quiet: Io = { ...io, stdout: io.stderr };

  return {
    ...syncScanPorts(quiet, read),
    baselines: new BaselineAdapter(io),
    onScanEvent: (event) => printEvent(event, false, quiet),
  };
}
