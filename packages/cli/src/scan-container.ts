import {
  createScan,
  type Scan,
  type ScanPorts,
  type SyncPorts,
} from "@recognizer/core";
import { ClockAdapter } from "./adapters/clock-adapter.js";
import { ConfirmAdapter } from "./adapters/confirm-adapter.js";
import { DescriberAdapter } from "./adapters/describer-adapter.js";
import { GitAdapter } from "./adapters/git-adapter.js";
import { ProcessAdapter } from "./adapters/process-adapter.js";
import {
  ScannersAdapter,
  SyncScannersAdapter,
} from "./adapters/scanners-adapter.js";
import { SensorsAdapter } from "./adapters/sensors-adapter.js";
import { StoreAdapter } from "./adapters/store-adapter.js";
import type { Io } from "./cli.js";
import type { ConfigRead } from "./config-parse.js";

export function scanPorts(io: Io, read: ConfigRead): ScanPorts {
  const scanners = new ScannersAdapter(io);

  return {
    scanners,
    sensors: new SensorsAdapter(io),
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
