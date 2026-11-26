import type { ConfigRepository } from "../domain/config-repository.js";
import type { FindingsRepository } from "../domain/findings-repository.js";
import type { LanguageRule } from "../domain/language-rule.js";
import type { PolicyRepository } from "../domain/policy-repository.js";
import { Repository } from "../domain/repository.js";
import type { ScanOutcome } from "../domain/run/scan-outcome.js";
import type { PlanRequest, ScanPlanView } from "../domain/run/scan-plan.js";
import type { ScanRequest } from "../domain/run/scan-request.js";
import type { RunLogRepository } from "../domain/run-log-repository.js";
import type { ScanEvent } from "../domain/scan-event.js";
import type { SensorRow } from "../domain/scan-plan.js";
import type { StructureRepository } from "../domain/structure-repository.js";
import {
  type CheckReport,
  type CheckRequest,
  checkRepository,
  refuseBadCheckRequest,
} from "./analysis/check-repository.js";
import type { AnalysisPorts } from "./analysis/internal/analysis-ports.js";
import type { Analysis } from "./analysis/ports/analysis.js";
import type { Digest } from "./analysis/ports/digest.js";
import type { GrammarRules } from "./analysis/ports/grammar-rules.js";
import type { Parsing } from "./analysis/ports/parsing.js";
import type { PublishedLanguages } from "./analysis/ports/published-languages.js";
import type { SourceFiles } from "./analysis/ports/source-files.js";
import type { TestReports } from "./analysis/ports/test-reports.js";
import {
  type ReportOutcome,
  reportFindings,
} from "./analysis/report-findings.js";
import { runAnalysis } from "./analysis/run-analysis.js";
import { runAnalysisSync } from "./analysis/run-analysis-sync.js";
import { testsHashOf } from "./analysis/tests-hash.js";
import { applySetup } from "./configuration/apply-setup.js";
import { buildSetupChanges } from "./configuration/build-setup-changes.js";
import { editKey } from "./configuration/edit-key.js";
import type {
  ConfigurationPorts,
  SetupReads,
} from "./configuration/internal/configuration-ports.js";
import { addForbid, migratePolicy } from "./configuration/migrate-policy.js";
import { readKeySchema } from "./configuration/read-key-schema.js";
import { readSetup } from "./configuration/read-setup.js";
import { recommendPolicy } from "./configuration/recommend-policy.js";
import { surveySetup } from "./configuration/survey-setup.js";
import { trySetup } from "./configuration/try-setup.js";
import { writeConfigEdits } from "./configuration/write-config-edits.js";
import { checkDescriptions } from "./describing/check-descriptions.js";
import { describeFiles } from "./describing/describe-files.js";
import { describeModules } from "./describing/describe-modules.js";
import { describeRecorded } from "./describing/describe-recorded.js";
import { describingSettings } from "./describing/describing-settings.js";
import { findDescribeGap } from "./describing/find-describe-gap.js";
import { findDescriberGaps } from "./describing/find-describer-gaps.js";
import type { DescribingPorts } from "./describing/internal/describing-ports.js";
import { isDescriberRegistered } from "./describing/is-describer-registered.js";
import { locateDescriber } from "./describing/locate-describer.js";
import type { Confirm } from "./describing/ports/confirm.js";
import type { Describer } from "./describing/ports/describer.js";
import { readDescriber } from "./describing/read-describer.js";
import { readResponsibility } from "./describing/read-responsibility.js";
import type { BaselineRepository } from "./history/settle-baseline.js";
import { diagnose } from "./plugins/diagnose.js";
import { discoverPlugins } from "./plugins/discover-plugins.js";
import { readInstalledSensors } from "./plugins/installed-sensors.js";
import type { PluginPorts } from "./plugins/internal/plugin-ports.js";
import { type FreshSources, freshStructure } from "./run/fresh-structure.js";
import { drive } from "./run/internal/async-driver.js";
import { EventQueue } from "./run/internal/event-queue.js";
import { FlowContext } from "./run/internal/flow-context.js";
import { driveSync } from "./run/internal/sync-driver.js";
import type { RunPhases } from "./run/phases.js";
import type { PlanPhases } from "./run/plan-scan.js";
import { planScan } from "./run/plan-scan.js";
import type { RunningScan, Scan } from "./run/ports/scan.js";
import type { RunPorts } from "./run/scan-flow.js";
import { detectLanguages } from "./scanning/detect-languages.js";
import { discoverScanners } from "./scanning/discover-scanners.js";
import { extractScans } from "./scanning/extract-scans.js";
import { extractScansSync } from "./scanning/extract-scans-sync.js";
import type { ScanningQueries } from "./scanning/internal/scanning-ports.js";
import type {
  ScannerQueries,
  Scanners,
  SyncScanners,
} from "./scanning/ports/scanners.js";
import { readScannerSetup } from "./scanning/read-scanner-setup.js";
import { findCommitGaps } from "./sensing/find-commit-gaps.js";
import { findProgramGaps } from "./sensing/find-program-gaps.js";
import { findReadinessGaps } from "./sensing/find-readiness-gaps.js";
import { findSensorGaps } from "./sensing/find-sensor-gaps.js";
import type { SensingPorts } from "./sensing/internal/sensing-ports.js";
import { planSensors } from "./sensing/plan-sensors.js";
import type { SelectionFiles } from "./sensing/ports/selection-files.js";
import type { SensorCatalog } from "./sensing/ports/sensor-catalog.js";
import type { Sensors } from "./sensing/ports/sensors.js";
import { readRunConfig } from "./sensing/read-run-config.js";
import { readSensorRows } from "./sensing/read-sensor-rows.js";
import { runSensors } from "./sensing/run-sensors.js";
import { selectSensors } from "./sensing/select-sensors.js";
import type { Clock } from "./shared/ports/clock.js";
import type { Git } from "./shared/ports/git.js";
import type { ProcessControl, Say } from "./shared/ports/process.js";
import type { ScanLock } from "./shared/ports/scan-lock.js";
import { addToView } from "./visualisation/add-to-view.js";
import { askCallers } from "./visualisation/ask-callers.js";
import { askPath } from "./visualisation/ask-path.js";
import { askUsedBy } from "./visualisation/ask-used-by.js";
import { askUses } from "./visualisation/ask-uses.js";
import { changeView } from "./visualisation/change-view.js";
import { checkViews } from "./visualisation/check-views.js";
import { createView } from "./visualisation/create-view.js";
import { diffView } from "./visualisation/diff-view.js";
import { focusView } from "./visualisation/focus-view.js";
import { foldView } from "./visualisation/fold-view.js";
import type { VisualisationPorts } from "./visualisation/internal/visualisation-ports.js";
import { listViews } from "./visualisation/list-views.js";
import { noteView } from "./visualisation/note-view.js";
import { removeFromView } from "./visualisation/remove-from-view.js";
import { removeView } from "./visualisation/remove-view.js";
import { reorderViewNotes } from "./visualisation/reorder-view-notes.js";
import { ruleView } from "./visualisation/rule-view.js";
import { setView } from "./visualisation/set-view.js";
import { showView } from "./visualisation/show-view.js";

interface CommonPorts {
  analysis: Analysis;
  sensors: Sensors;
  catalog: SensorCatalog;
  files: SelectionFiles;
  describer: Describer;
  responsibilities: DescribingPorts["responsibilities"];
  git: Git;
  structure: StructureRepository;
  findings: FindingsRepository;
  policy: PolicyRepository;
  config: ConfigRepository;
  runLog: RunLogRepository;
  lock: ScanLock;
  confirm: Confirm;
  clock: Clock;
  process: ProcessControl;
  source: SourceFiles;
  digest: Digest;
  parsing: Parsing;
  grammarRules: GrammarRules;
  languages: PublishedLanguages;
  testReports: TestReports;
}

export interface ScanPorts extends CommonPorts {
  scanners: Scanners;
}

export interface SyncPorts extends CommonPorts {
  scanners: SyncScanners;
}

function runPorts(ports: CommonPorts): RunPorts {
  return {
    git: ports.git,
    structure: ports.structure,
    lock: ports.lock,
    runLog: ports.runLog,
    clock: ports.clock,
    process: ports.process,
  };
}

function bindDecisions(
  ports: CommonPorts,
  scanning: ScanningQueries,
): Omit<RunPhases, "extractScans" | "runAnalysis"> {
  const sensing: SensingPorts = {
    sensors: ports.sensors,
    config: ports.config,
    clock: ports.clock,
    catalog: ports.catalog,
    files: ports.files,
  };
  const describing: DescribingPorts = {
    describer: ports.describer,
    confirm: ports.confirm,
    clock: ports.clock,
    responsibilities: ports.responsibilities,
    runLog: ports.runLog,
  };

  return {
    discoverScanners: () => discoverScanners(scanning),
    readScannerSetup: (root) => readScannerSetup(scanning, root),
    readRunConfig: (root, skipRetired) =>
      readRunConfig(sensing, root, skipRetired),
    locateDescriber: (root) => locateDescriber(describing, root),
    selectSensors: (input) => selectSensors(sensing, input),
    planSensors: (input) => planSensors(sensing, input),
    detectLanguages: (input) => detectLanguages(scanning, input),
    describingSettings: (describer, root) =>
      describingSettings(describing, describer, root),
    findCommitGaps: (input) => findCommitGaps(input),
    findDescriberGaps: (input) => findDescriberGaps(describing, input),
    findProgramGaps: (input) => findProgramGaps(sensing, input),
    isDescriberRegistered,
    findReadinessGaps: (input) => findReadinessGaps(sensing, input),
    describeFiles: (input) => describeFiles(describing, input),
    runSensors: (input) => runSensors(sensing, input),
  };
}

export interface PlanningPorts {
  structure: Pick<StructureRepository, "read">;
  describer: Pick<Describer, "locate">;
  responsibilities: Parameters<typeof findDescribeGap>[0]["responsibilities"];
  findings: Pick<FindingsRepository, "measuredOf">;
  tests: { current(root: string): string | null };
  sensors: { registered(root: string): SensorRow[] };
}

function planningOver(ports: CommonPorts): PlanningPorts {
  return {
    structure: ports.structure,
    describer: ports.describer,
    responsibilities: ports.responsibilities,
    findings: ports.findings,
    tests: {
      current: (root) => testsHashOf(ports, root, new Map()),
    },
    sensors: {
      registered: (root) =>
        readSensorRows({ config: ports.config, catalog: ports.catalog }, root),
    },
  };
}

function planPhasesOver(ports: PlanningPorts): PlanPhases {
  return {
    readSensorRows: (root) => ports.sensors.registered(root),
    readModules: (root) =>
      ports.structure.read(root).files.map(({ path }) => path),
    findSensorGaps: (root, rows, modules) =>
      findSensorGaps(ports, root, rows, modules),
    findDescribeGap: (root, modules) => findDescribeGap(ports, root, modules),
  };
}

export function describingOver(ports: DescribingPorts) {
  return {
    describeModules: (request: Parameters<typeof describeModules>[1]) =>
      describeModules(ports, request),
    describeRecorded: (request: Parameters<typeof describeRecorded>[1]) =>
      describeRecorded(ports, request),
    checkDescriptions: (request: Parameters<typeof checkDescriptions>[1]) =>
      checkDescriptions(ports, request),
    readDescriber: (root: string) => readDescriber(ports, root),
    readResponsibility: (request: Parameters<typeof readResponsibility>[1]) =>
      readResponsibility(ports, request),
  };
}

export function createPlanner(
  ports: PlanningPorts,
): (request: PlanRequest) => Promise<ScanPlanView> {
  const phases = planPhasesOver(ports);

  return (request) => Promise.resolve(planScan(phases, request));
}

function analysisOver(ports: CommonPorts): AnalysisPorts {
  return {
    analysis: ports.analysis,
    config: ports.config,
    findings: ports.findings,
    policy: ports.policy,
    clock: ports.clock,
    source: ports.source,
    digest: ports.digest,
    parsing: ports.parsing,
    grammarRules: ports.grammarRules,
    languages: ports.languages,
  };
}

function phasesOver(ports: ScanPorts): RunPhases {
  const scanning = {
    scanners: ports.scanners,
    structure: ports.structure,
    config: ports.config,
  };
  const analysis = analysisOver(ports);

  return {
    ...bindDecisions(ports, scanning),
    extractScans: (input) => extractScans(scanning, input),
    runAnalysis: (input) => runAnalysis(analysis, input),
  };
}

function syncPhasesOver(ports: SyncPorts): RunPhases {
  const scanning = {
    scanners: ports.scanners,
    structure: ports.structure,
    config: ports.config,
  };
  const analysis = analysisOver(ports);

  return {
    ...bindDecisions(ports, scanning),
    extractScans: (input) => extractScansSync(scanning, input),
    runAnalysis: (input) => runAnalysisSync(analysis, input),
  };
}

export function createScan(ports: ScanPorts): Scan {
  const run = runPorts(ports);
  const phases = phasesOver(ports);
  const plan = createPlanner(planningOver(ports));

  return {
    start(request: ScanRequest): RunningScan {
      const queue = new EventQueue();
      const ctx = new FlowContext(true, (event) => queue.push(event));

      ctx.flush = () => queue.drained();

      const outcome = Promise.resolve()
        .then(() => drive(request, run, phases, ctx))
        .finally(() => queue.close());

      return {
        events: queue.iterable(),
        outcome,
        async stop() {
          ctx.stopped = true;
          await ports.process.stopAll();
          ctx.lock?.release();
        },
      };
    },
    status: (repository) => Promise.resolve(ports.lock.status(repository)),
    plan,
  };
}

export function scanSync(
  request: ScanRequest,
  ports: SyncPorts,
  onEvent: (event: ScanEvent) => void,
): ScanOutcome {
  const ctx = new FlowContext(false, onEvent);

  return driveSync(request, runPorts(ports), syncPhasesOver(ports), ctx);
}

export interface FreshPorts extends SyncPorts {
  baselines: BaselineRepository;
  onScanEvent: (event: ScanEvent) => void;
}

export interface FreshRequest {
  scan: ScanRequest;
}

function freshSources(ports: FreshPorts, request: FreshRequest): FreshSources {
  return {
    isDirectory: (root) => ports.structure.exists(root),
    validateConfig: (root) => {
      ports.config.run(root, false);
    },
    detect: (root) => {
      ports.scanners.discover();

      return ports.scanners.detect(root, {});
    },
    readCached: (root, language) => ports.scanners.readCached(root, language),
    commit: (root) => ports.git.commit(root),
    dirty: (root) => ports.git.dirty(root),
    hashOf: (root, path) => ports.source.hashOf(root, path),
    extract: () => scanSync(request.scan, ports, ports.onScanEvent),
  };
}

export function freshScansOver(
  ports: FreshPorts,
  request: FreshRequest,
  root: string,
): { repository: Repository; scanned: boolean } {
  return freshStructure(freshSources(ports, request), root);
}

export function checkRepositoryFresh(
  ports: FreshPorts,
  say: Say,
  request: CheckRequest & FreshRequest,
): CheckReport {
  refuseBadCheckRequest(request);

  const { repository } = freshStructure(
    freshSources(ports, request),
    request.root,
  );

  return checkRepository(ports, say, request, repository);
}

export function reportFindingsFresh(
  ports: FreshPorts,
  request: FreshRequest & {
    root: string;
    as: string | undefined;
    findingsText: () => string;
  },
): ReportOutcome {
  return reportFindings(ports, {
    root: request.root,
    as: request.as,
    findingsText: request.findingsText,
    repository: () =>
      freshStructure(freshSources(ports, request), request.root).repository,
  });
}

export interface VisualisationBase {
  views: VisualisationPorts["views"];
  changes: VisualisationPorts["changes"];
  windows: VisualisationPorts["windows"];
}

export function visualisationFresh(
  ports: FreshPorts & VisualisationBase,
  request: (root: string) => FreshRequest,
): VisualisationPorts {
  return {
    views: ports.views,
    git: ports.git,
    changes: ports.changes,
    windows: ports.windows,
    freshRepository: (root) =>
      freshScansOver(ports, request(root), root).repository,
  };
}

export function visualisationOver(ports: VisualisationPorts) {
  return {
    addToView: (request: Parameters<typeof addToView>[1]) =>
      addToView(ports, request),
    askCallers: (request: Parameters<typeof askCallers>[1]) =>
      askCallers(ports, request),
    askPath: (request: Parameters<typeof askPath>[1]) =>
      askPath(ports, request),
    askUsedBy: (request: Parameters<typeof askUsedBy>[1]) =>
      askUsedBy(ports, request),
    askUses: (request: Parameters<typeof askUses>[1]) =>
      askUses(ports, request),
    changeView: (request: Parameters<typeof changeView>[1]) =>
      changeView(ports, request),
    checkViews: (request: Parameters<typeof checkViews>[1]) =>
      checkViews(ports, request),
    createView: (request: Parameters<typeof createView>[1]) =>
      createView(ports, request),
    diffView: (request: Parameters<typeof diffView>[1]) =>
      diffView(ports, request),
    focusView: (request: Parameters<typeof focusView>[1]) =>
      focusView(ports, request),
    foldView: (request: Parameters<typeof foldView>[1]) =>
      foldView(ports, request),
    listViews: (request: Parameters<typeof listViews>[1]) =>
      listViews(ports, request),
    noteView: (request: Parameters<typeof noteView>[1]) =>
      noteView(ports, request),
    removeFromView: (request: Parameters<typeof removeFromView>[1]) =>
      removeFromView(ports, request),
    removeView: (request: Parameters<typeof removeView>[1]) =>
      removeView(ports, request),
    reorderViewNotes: (request: Parameters<typeof reorderViewNotes>[1]) =>
      reorderViewNotes(ports, request),
    ruleView: (request: Parameters<typeof ruleView>[1]) =>
      ruleView(ports, request),
    setView: (request: Parameters<typeof setView>[1]) =>
      setView(ports, request),
    showView: (request: Parameters<typeof showView>[1]) =>
      showView(ports, request),
  };
}

export interface SetupReadsSources {
  plugins: Pick<PluginPorts, "programs" | "validators" | "repository">;
  scanners: ScannerQueries;
}

export function setupReadsOver({
  plugins,
  scanners,
}: SetupReadsSources): SetupReads {
  return {
    languageRules: () =>
      discoverPlugins(plugins, ["scanner"]).plugins.flatMap(
        (scanner) => (scanner.manifest.languages ?? []) as LanguageRule[],
      ),
    cachedScans: (root) => {
      scanners.discover();

      const parts = scanners
        .detect(root, {})
        .map((language) => scanners.readCached(root, language));

      return parts.length > 0 && parts.every((part) => part !== null)
        ? Repository.join(parts as Repository[])
        : null;
    },
    sensors: () =>
      readInstalledSensors(plugins).sensors.map((sensor) => ({
        name: sensor.name,
        display: sensor.display,
        ...(sensor.description === undefined
          ? {}
          : { description: sensor.description }),
        runs_tests: sensor.runs_tests,
      })),
    describers: () =>
      discoverPlugins(plugins, ["describer"]).plugins.map((describer) => ({
        name: describer.name,
        display: describer.manifest.display,
        ...(describer.manifest.description === undefined
          ? {}
          : { description: describer.manifest.description }),
        runs_tests: false,
      })),
    diagnose: (root) => diagnose(plugins, root, false),
  };
}

export function configurationOver(ports: ConfigurationPorts) {
  return {
    surveySetup: (request: Parameters<typeof surveySetup>[1]) =>
      surveySetup(ports, request),
    buildSetupChanges: (request: Parameters<typeof buildSetupChanges>[1]) =>
      buildSetupChanges(ports, request),
    recommendPolicy: (request: Parameters<typeof recommendPolicy>[1]) =>
      recommendPolicy(ports, request),
    applySetup: (request: Parameters<typeof applySetup>[1]) =>
      applySetup(ports, request),
    trySetup: (request: Parameters<typeof trySetup>[1]) =>
      trySetup(ports, request),
    readSetup: (request: Parameters<typeof readSetup>[1]) =>
      readSetup(ports, request),
    editKey: (request: Parameters<typeof editKey>[1]) =>
      editKey(ports, request),
    readKeySchema: () => readKeySchema(ports),
    migratePolicy: (request: Parameters<typeof migratePolicy>[1]) =>
      migratePolicy(ports, request),
    addForbid: (request: Parameters<typeof addForbid>[1]) =>
      addForbid(ports, request),
    writeConfigEdits: (request: Parameters<typeof writeConfigEdits>[1]) =>
      writeConfigEdits(ports, request),
  };
}
