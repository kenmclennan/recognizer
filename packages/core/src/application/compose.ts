import type { ConfigRepository } from "../domain/config-repository.js";
import type { FindingsRepository } from "../domain/findings-repository.js";
import type { PolicyRepository } from "../domain/policy-repository.js";
import type { Repository } from "../domain/repository.js";
import type { ScanOutcome } from "../domain/run/scan-outcome.js";
import type { PlanRequest, ScanPlanView } from "../domain/run/scan-plan.js";
import type { ScanRequest } from "../domain/run/scan-request.js";
import type { RunLogRepository } from "../domain/run-log-repository.js";
import type { ScanEvent } from "../domain/scan-event.js";
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
import type { Parsing } from "./analysis/ports/parsing.js";
import type { SourceFiles } from "./analysis/ports/source-files.js";
import type { Toml } from "./analysis/ports/toml.js";
import {
  type ReportOutcome,
  reportFindings,
} from "./analysis/report-findings.js";
import { runAnalysis } from "./analysis/run-analysis.js";
import { runAnalysisSync } from "./analysis/run-analysis-sync.js";
import { describeFiles } from "./describing/describe-files.js";
import { describingSettings } from "./describing/describing-settings.js";
import { findDescribeGap } from "./describing/find-describe-gap.js";
import { findDescriberGaps } from "./describing/find-describer-gaps.js";
import type { DescribingPorts } from "./describing/internal/describing-ports.js";
import { isDescriberRegistered } from "./describing/is-describer-registered.js";
import { locateDescriber } from "./describing/locate-describer.js";
import type { Confirm } from "./describing/ports/confirm.js";
import type { Describer } from "./describing/ports/describer.js";
import { refuseShippedDescriber } from "./describing/refuse-shipped-describer.js";
import type { BaselineRepository } from "./history/settle-baseline.js";
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
import type { Scanners, SyncScanners } from "./scanning/ports/scanners.js";
import { readScannerSetup } from "./scanning/read-scanner-setup.js";
import { findCommitGaps } from "./sensing/find-commit-gaps.js";
import { findProgramGaps } from "./sensing/find-program-gaps.js";
import { findReadinessGaps } from "./sensing/find-readiness-gaps.js";
import { findSensorGaps } from "./sensing/find-sensor-gaps.js";
import type { SensingPorts } from "./sensing/internal/sensing-ports.js";
import { planSensors } from "./sensing/plan-sensors.js";
import type { Sensors } from "./sensing/ports/sensors.js";
import { readRunConfig } from "./sensing/read-run-config.js";
import { readSensorRows } from "./sensing/read-sensor-rows.js";
import { runSensors } from "./sensing/run-sensors.js";
import { selectSensors } from "./sensing/select-sensors.js";
import type { Clock } from "./shared/ports/clock.js";
import type { Git } from "./shared/ports/git.js";
import type { ProcessControl, Say } from "./shared/ports/process.js";
import type { ScanLock } from "./shared/ports/scan-lock.js";

interface CommonPorts {
  analysis: Analysis;
  sensors: Sensors;
  describer: Describer;
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
  toml: Toml;
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
  };
  const describing: DescribingPorts = {
    describer: ports.describer,
    confirm: ports.confirm,
    clock: ports.clock,
  };

  return {
    discoverScanners: () => discoverScanners(scanning),
    readScannerSetup: (root) => readScannerSetup(scanning, root),
    readRunConfig: (root, skipRetired) =>
      readRunConfig(sensing, root, skipRetired),
    locateDescriber: (root) => locateDescriber(describing, root),
    selectSensors: (input) => selectSensors(sensing, input),
    refuseShippedDescriber: (located) =>
      refuseShippedDescriber(describing, located),
    planSensors: (input) => planSensors(sensing, input),
    detectLanguages: (input) => detectLanguages(scanning, input),
    describingSettings: () => describingSettings(describing),
    findCommitGaps: (input) => findCommitGaps(sensing, input),
    findDescriberGaps: (input) => findDescriberGaps(describing, input),
    findProgramGaps: (input) => findProgramGaps(sensing, input),
    isDescriberRegistered,
    findReadinessGaps: (input) => findReadinessGaps(sensing, input),
    describeFiles: (input) => describeFiles(describing, input),
    runSensors: (input) => runSensors(sensing, input),
  };
}

export interface PlanningPorts {
  structure: Pick<StructureRepository, "read" | "responsibilityKinds">;
  findings: Pick<FindingsRepository, "measuredOf" | "testsDigest">;
  sensors: Pick<Sensors, "registered">;
}

function planPhasesOver(ports: PlanningPorts): PlanPhases {
  return {
    readSensorRows: (root) => readSensorRows(ports, root),
    readModules: (root) =>
      ports.structure.read(root).files.map(({ path }) => path),
    findSensorGaps: (root, rows, modules) =>
      findSensorGaps(ports, root, rows, modules),
    findDescribeGap: (root, modules) => findDescribeGap(ports, root, modules),
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
  const plan = createPlanner(ports);

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
