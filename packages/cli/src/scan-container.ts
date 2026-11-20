import {
  createScan,
  type Scan,
  type ScanPorts,
  type SyncPorts,
} from "@recognizer/core";
import { StoreAdapter } from "./adapters/filesystem/store-adapter.js";
import { GitAdapter } from "./adapters/git/git-adapter.js";
import { DescriberAdapter } from "./adapters/plugins/describer-adapter.js";
import { ProcessAdapter } from "./adapters/plugins/process-adapter.js";
import {
  ScannersAdapter,
  SyncScannersAdapter,
} from "./adapters/plugins/scanners-adapter.js";
import { SensorsAdapter } from "./adapters/plugins/sensors-adapter.js";
import { ClockAdapter } from "./adapters/system/clock-adapter.js";
import { ConfirmAdapter } from "./adapters/terminal/confirm-adapter.js";
import type { Io } from "./cli.js";
import type { ConfigRead } from "./config-parse.js";

export function scanPorts(io: Io, read: ConfigRead): ScanPorts {
  const scanners = new ScannersAdapter(io);
  const sensors = new SensorsAdapter(io);

  return {
    scanners,
    analysis: sensors,
    sensors,
    describer: new DescriberAdapter(io),
    git: new GitAdapter(io),
    store: new StoreAdapter(io, read),
    confirm: new ConfirmAdapter(io),
    clock: new ClockAdapter(io),
    process: new ProcessAdapter(io, () => scanners.installedPlugins()),
  };
}

export function syncScanPorts(io: Io, read: ConfigRead): SyncPorts {
  const scanners = new SyncScannersAdapter(io);

  return {
    ...scanPorts(io, read),
    scanners,
    process: new ProcessAdapter(io, () => scanners.installedPlugins()),
  };
}

export function createScanContainer(io: Io, read: ConfigRead): Scan {
  return createScan(scanPorts(io, read));
}
