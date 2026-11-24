import {
  type ConfigurationPorts,
  createScan,
  type PluginPorts,
  type Scan,
  type ScanPorts,
  setupReadsOver,
} from "../../src/index.js";
import { FakeAnalysis } from "./fake-analysis.js";
import { FakeAssistant } from "./fake-assistant.js";
import { FakeBaselineRepository } from "./fake-baseline-repository.js";
import { FakeChanges } from "./fake-changes.js";
import { FakeCheckSandbox } from "./fake-check-sandbox.js";
import { FakeClock } from "./fake-clock.js";
import { FakeConfigKeys } from "./fake-config-keys.js";
import { FakeConfigRepository } from "./fake-config-repository.js";
import { FakeConfirm } from "./fake-confirm.js";
import { FakeDescriber } from "./fake-describer.js";
import { FakeDigest } from "./fake-digest.js";
import { FakeDocumentValidators } from "./fake-document-validators.js";
import { FakeFindingsRepository } from "./fake-findings-repository.js";
import { FakeForge } from "./fake-forge.js";
import { FakeGit } from "./fake-git.js";
import { FakeGrammarRules } from "./fake-grammar-rules.js";
import { FakeKeyOwners } from "./fake-key-owners.js";
import { FakeKeyedText } from "./fake-keyed-text.js";
import { FakeParsing } from "./fake-parsing.js";
import { FakePluginRegistry } from "./fake-plugin-registry.js";
import { FakePluginTemplates } from "./fake-plugin-templates.js";
import { FakePolicyRepository } from "./fake-policy-repository.js";
import { FakeProcess } from "./fake-process.js";
import { FakePrograms } from "./fake-programs.js";
import { FakePublishedLanguages } from "./fake-published-languages.js";
import { FakeRecordedScans } from "./fake-recorded-scans.js";
import { FakeRepositoryChecks } from "./fake-repository-checks.js";
import { FakeResponsibilitiesRepository } from "./fake-responsibilities-repository.js";
import { FakeRunLogRepository } from "./fake-run-log-repository.js";
import { FakeScanCache } from "./fake-scan-cache.js";
import { FakeScanLock } from "./fake-scan-lock.js";
import { FakeScanners } from "./fake-scanners.js";
import { FakeScratch } from "./fake-scratch.js";
import { FakeSelectionFiles } from "./fake-selection-files.js";
import { FakeSensorCatalog } from "./fake-sensor-catalog.js";
import { FakeSensors } from "./fake-sensors.js";
import { FakeSetupFiles } from "./fake-setup-files.js";
import { FakeSetupScan } from "./fake-setup-scan.js";
import { FakeShippedPlugins } from "./fake-shipped-plugins.js";
import { FakeSourceFiles } from "./fake-source-files.js";
import { FakeStructureRepository } from "./fake-structure-repository.js";
import { FakeSurveyPlugins } from "./fake-survey-plugins.js";
import { FakeTestReports } from "./fake-test-reports.js";
import { FakeViewRepository } from "./fake-view-repository.js";
import { FakeWindows } from "./fake-windows.js";
import { FakeWorkTree } from "./fake-work-tree.js";
import { FIXTURE_LANGUAGES } from "./fixture-languages.js";

export interface Fakes {
  scanners: FakeScanners;
  analysis: FakeAnalysis;
  sensors: FakeSensors;
  catalog: FakeSensorCatalog;
  files: FakeSelectionFiles;
  describer: FakeDescriber;
  responsibilities: FakeResponsibilitiesRepository;
  git: FakeGit;
  forge: FakeForge;
  recordedScans: FakeRecordedScans;
  workTree: FakeWorkTree;
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
  grammarRules: FakeGrammarRules;
  languages: FakePublishedLanguages;
  testReports: FakeTestReports;
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
  scratch: FakeScratch;
  scanCache: FakeScanCache;
  setupFiles: FakeSetupFiles;
  surveyPlugins: FakeSurveyPlugins;
  assistant: FakeAssistant;
  setupScan: FakeSetupScan;
  configKeys: FakeConfigKeys;
  keyedText: FakeKeyedText;
  keyOwners: FakeKeyOwners;
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
    catalog: new FakeSensorCatalog(sensors),
    files: new FakeSelectionFiles(),
    describer: new FakeDescriber(),
    responsibilities: new FakeResponsibilitiesRepository(),
    git: new FakeGit(commit),
    forge: new FakeForge(),
    recordedScans: new FakeRecordedScans(),
    workTree: new FakeWorkTree(),
    structure,
    findings: new FakeFindingsRepository(),
    policy: new FakePolicyRepository(),
    config: new FakeConfigRepository(sensors),
    runLog: new FakeRunLogRepository(),
    lock: new FakeScanLock(),
    baseline: new FakeBaselineRepository(),
    confirm: new FakeConfirm(true),
    clock: new FakeClock(),
    process,
    source: new FakeSourceFiles(),
    digest: new FakeDigest(),
    parsing: new FakeParsing(),
    grammarRules: new FakeGrammarRules(),
    languages: new FakePublishedLanguages(FIXTURE_LANGUAGES),
    testReports: new FakeTestReports(),
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
    scratch: new FakeScratch(),
    scanCache: new FakeScanCache(),
    setupFiles: new FakeSetupFiles(),
    surveyPlugins: new FakeSurveyPlugins(),
    assistant: new FakeAssistant(),
    setupScan: new FakeSetupScan(),
    configKeys: new FakeConfigKeys(),
    keyedText: new FakeKeyedText(),
    keyOwners: new FakeKeyOwners(),
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
    scratch,
    scanCache,
    setupFiles,
    surveyPlugins,
    assistant,
    setupScan,
    configKeys,
    keyedText,
    keyOwners,
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

export function configurationPortsOf(fakes: Fakes): ConfigurationPorts {
  return {
    files: fakes.setupFiles,
    plugins: fakes.surveyPlugins,
    assistant: fakes.assistant,
    scan: fakes.setupScan,
    keys: fakes.configKeys,
    keyedText: fakes.keyedText,
    keyOwners: fakes.keyOwners,
    config: fakes.config,
    policy: fakes.policy,
    programs: fakes.programs,
    lock: fakes.lock,
    clock: fakes.clock,
    version: "0.0.0-test",
    reads: setupReadsOver({
      plugins: pluginPortsOf(fakes),
      scanners: fakes.scanners,
    }),
  };
}
