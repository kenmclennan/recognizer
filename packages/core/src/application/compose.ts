import type { ScanEvent } from "../domain/scan-event.js";
import type { ScanOutcome } from "../domain/scan-outcome.js";
import type { ScanRequest } from "../domain/scan-request.js";
import type { AnalysisPorts } from "./analysis/internal/analysis-ports.js";
import type { Analysis } from "./analysis/ports/analysis.js";
import { runAnalysis } from "./analysis/run-analysis.js";
import { runAnalysisSync } from "./analysis/run-analysis-sync.js";
import { describeFiles } from "./describing/describe-files.js";
import { describingSettings } from "./describing/describing-settings.js";
import { findDescriberGaps } from "./describing/find-describer-gaps.js";
import type { DescribingPorts } from "./describing/internal/describing-ports.js";
import { isDescriberRegistered } from "./describing/is-describer-registered.js";
import { locateDescriber } from "./describing/locate-describer.js";
import type { Confirm } from "./describing/ports/confirm.js";
import type { Describer } from "./describing/ports/describer.js";
import { refuseShippedDescriber } from "./describing/refuse-shipped-describer.js";
import { drive } from "./run/internal/async-driver.js";
import { EventQueue } from "./run/internal/event-queue.js";
import { FlowContext } from "./run/internal/flow-context.js";
import { driveSync } from "./run/internal/sync-driver.js";
import type { RunPhases } from "./run/phases.js";
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
import type { SensingPorts } from "./sensing/internal/sensing-ports.js";
import { planSensors } from "./sensing/plan-sensors.js";
import type { Sensors } from "./sensing/ports/sensors.js";
import { readRunConfig } from "./sensing/read-run-config.js";
import { runSensors } from "./sensing/run-sensors.js";
import { selectSensors } from "./sensing/select-sensors.js";
import type { Clock } from "./shared/ports/clock.js";
import type { Git } from "./shared/ports/git.js";
import type { ProcessControl } from "./shared/ports/process.js";
import type { Store } from "./shared/ports/store.js";

interface CommonPorts {
  analysis: Analysis;
  sensors: Sensors;
  describer: Describer;
  git: Git;
  store: Store;
  confirm: Confirm;
  clock: Clock;
  process: ProcessControl;
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
    store: ports.store,
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
    store: ports.store,
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

function analysisOver(ports: CommonPorts): AnalysisPorts {
  return { analysis: ports.analysis, store: ports.store, clock: ports.clock };
}

function phasesOver(ports: ScanPorts): RunPhases {
  const scanning = { scanners: ports.scanners, store: ports.store };
  const analysis = analysisOver(ports);

  return {
    ...bindDecisions(ports, scanning),
    extractScans: (input) => extractScans(scanning, input),
    runAnalysis: (input) => runAnalysis(analysis, input),
  };
}

function syncPhasesOver(ports: SyncPorts): RunPhases {
  const scanning = { scanners: ports.scanners, store: ports.store };
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
    status: (repository) => Promise.resolve(ports.store.status(repository)),
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
