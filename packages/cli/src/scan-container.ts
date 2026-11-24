import {
  createScan,
  type Scan,
  type ScanPorts,
  type SyncPorts,
} from "@recognizer/core";
import { ConfigAdapter } from "./adapters/filesystem/config-adapter.js";
import { FindingsAdapter } from "./adapters/filesystem/findings-adapter.js";
import { ParsingAdapter } from "./adapters/filesystem/parsing-adapter.js";
import { PolicyAdapter } from "./adapters/filesystem/policy-adapter.js";
import { ResponsibilitiesAdapter } from "./adapters/filesystem/responsibilities-adapter.js";
import { RunLogAdapter } from "./adapters/filesystem/run-log-adapter.js";
import { ScanLockAdapter } from "./adapters/filesystem/scan-lock-adapter.js";
import { SourceFilesAdapter } from "./adapters/filesystem/source-files-adapter.js";
import { StructureAdapter } from "./adapters/filesystem/structure-adapter.js";
import { GitAdapter } from "./adapters/git/git-adapter.js";
import { DescriberAdapter } from "./adapters/plugins/describer-adapter.js";
import { GrammarRulesAdapter } from "./adapters/plugins/grammar-rules-adapter.js";
import { ProcessAdapter } from "./adapters/plugins/process-adapter.js";
import {
  ScannersAdapter,
  SyncScannersAdapter,
} from "./adapters/plugins/scanners-adapter.js";
import { SelectionFilesAdapter } from "./adapters/plugins/selection-files-adapter.js";
import { SensorCatalogAdapter } from "./adapters/plugins/sensor-catalog-adapter.js";
import { SensorsAdapter } from "./adapters/plugins/sensors-adapter.js";
import { TestReportsAdapter } from "./adapters/plugins/test-reports-adapter.js";
import { ClockAdapter } from "./adapters/system/clock-adapter.js";
import { DigestAdapter } from "./adapters/system/digest-adapter.js";
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
    catalog: new SensorCatalogAdapter(io),
    files: new SelectionFilesAdapter(io),
    describer: new DescriberAdapter(io),
    responsibilities: new ResponsibilitiesAdapter(io),
    git: new GitAdapter(io),
    structure: new StructureAdapter(io),
    findings: new FindingsAdapter(io),
    policy: new PolicyAdapter(io),
    config: new ConfigAdapter(io, read),
    runLog: new RunLogAdapter(io),
    lock: new ScanLockAdapter(io),
    confirm: new ConfirmAdapter(io),
    clock: new ClockAdapter(io),
    process: new ProcessAdapter(io, () => scanners.installedPlugins()),
    source: new SourceFilesAdapter(io),
    digest: new DigestAdapter(),
    parsing: new ParsingAdapter(),
    grammarRules: new GrammarRulesAdapter(() => scanners.installedPlugins()),
    testReports: new TestReportsAdapter(io),
  };
}

export function syncScanPorts(io: Io, read: ConfigRead): SyncPorts {
  const scanners = new SyncScannersAdapter(io);

  return {
    ...scanPorts(io, read),
    scanners,
    process: new ProcessAdapter(io, () => scanners.installedPlugins()),
    grammarRules: new GrammarRulesAdapter(() => scanners.installedPlugins()),
  };
}

export function createScanContainer(io: Io, read: ConfigRead): Scan {
  return createScan(scanPorts(io, read));
}
