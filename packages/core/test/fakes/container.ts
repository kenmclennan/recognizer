import {
  createScan,
  type PluginPorts,
  type Scan,
  type ScanPorts,
} from "../../src/index.js";
import { FakeAnalysis } from "./fake-analysis.js";
import { FakeBaselineRepository } from "./fake-baseline-repository.js";
import { FakeChanges } from "./fake-changes.js";
import { FakeCheckSandbox } from "./fake-check-sandbox.js";
import { FakeClock } from "./fake-clock.js";
import { FakeConfigRepository } from "./fake-config-repository.js";
import { FakeConfirm } from "./fake-confirm.js";
import { FakeDescriber } from "./fake-describer.js";
import { FakeDigest } from "./fake-digest.js";
import { FakeDocumentValidators } from "./fake-document-validators.js";
import { FakeFindingsRepository } from "./fake-findings-repository.js";
import { FakeGit } from "./fake-git.js";
import { FakeParsing } from "./fake-parsing.js";
import { FakePluginRegistry } from "./fake-plugin-registry.js";
import { FakePluginTemplates } from "./fake-plugin-templates.js";
import { FakePolicyRepository } from "./fake-policy-repository.js";
import { FakeProcess } from "./fake-process.js";
import { FakePrograms } from "./fake-programs.js";
import { FakeRepositoryChecks } from "./fake-repository-checks.js";
import { FakeRunLogRepository } from "./fake-run-log-repository.js";
import { FakeScanLock } from "./fake-scan-lock.js";
import { FakeScanners } from "./fake-scanners.js";
import { FakeSensors } from "./fake-sensors.js";
import { FakeShippedPlugins } from "./fake-shipped-plugins.js";
import { FakeSourceFiles } from "./fake-source-files.js";
import { FakeStructureRepository } from "./fake-structure-repository.js";
import { FakeToml } from "./fake-toml.js";
import { FakeViewRepository } from "./fake-view-repository.js";
import { FakeWindows } from "./fake-windows.js";

export interface Fakes {
  scanners: FakeScanners;
  analysis: FakeAnalysis;
  sensors: FakeSensors;
  describer: FakeDescriber;
  git: FakeGit;
  structure: FakeStructureRepository;
  findings: FakeFindingsRepository;
  policy: FakePolicyRepository;
  config: FakeConfigRepository;
  runLog: FakeRunLogRepository;
  lock: FakeScanLock;
  baseline: FakeBaselineRepository;
  confirm: FakeConfirm;
  clock: FakeClock;
  process: FakeProcess;
  source: FakeSourceFiles;
  digest: FakeDigest;
  parsing: FakeParsing;
  toml: FakeToml;
  changes: FakeChanges;
  views: FakeViewRepository;
  windows: FakeWindows;
  programs: FakePrograms;
  documentValidators: FakeDocumentValidators;
  checkSandbox: FakeCheckSandbox;
  pluginRegistry: FakePluginRegistry;
  pluginTemplates: FakePluginTemplates;
  shippedPlugins: FakeShippedPlugins;
  repositoryChecks: FakeRepositoryChecks;
}

export function createFakes(commit: string | null = "c0ffee"): Fakes {
  const log: string[] = [];
  const structure = new FakeStructureRepository();
  const sensors = new FakeSensors(log);
  const process = new FakeProcess();

  process.onStop(() => sensors.releaseHeld());

  return {
    scanners: new FakeScanners(structure, log),
    analysis: new FakeAnalysis(),
    sensors,
    describer: new FakeDescriber(),
    git: new FakeGit(commit),
    structure,
    findings: new FakeFindingsRepository(),
    policy: new FakePolicyRepository(),
    config: new FakeConfigRepository(),
    runLog: new FakeRunLogRepository(),
    lock: new FakeScanLock(),
    baseline: new FakeBaselineRepository(),
    confirm: new FakeConfirm(true),
    clock: new FakeClock(),
    process,
    source: new FakeSourceFiles(),
    digest: new FakeDigest(),
    parsing: new FakeParsing(),
    toml: new FakeToml(),
    changes: new FakeChanges(),
    views: new FakeViewRepository(),
    windows: new FakeWindows(),
    programs: new FakePrograms(),
    documentValidators: new FakeDocumentValidators(),
    checkSandbox: new FakeCheckSandbox(),
    pluginRegistry: new FakePluginRegistry(),
    pluginTemplates: new FakePluginTemplates(),
    shippedPlugins: new FakeShippedPlugins(),
    repositoryChecks: new FakeRepositoryChecks(),
  };
}

export function portsOf(fakes: Fakes): ScanPorts {
  const {
    changes,
    views,
    windows,
    programs,
    documentValidators,
    checkSandbox,
    pluginRegistry,
    pluginTemplates,
    shippedPlugins,
    repositoryChecks,
    ...scan
  } = fakes;

  return scan;
}

export function scanOver(fakes: Fakes): Scan {
  return createScan(portsOf(fakes));
}

export function pluginPortsOf(fakes: Fakes): PluginPorts {
  return {
    programs: fakes.programs,
    validators: fakes.documentValidators,
    sandbox: fakes.checkSandbox,
    registry: fakes.pluginRegistry,
    templates: fakes.pluginTemplates,
    shipped: fakes.shippedPlugins,
    repository: fakes.repositoryChecks,
  };
}
