import { createScan, type Scan, type ScanPorts } from "../../src/index.js";
import { FakeAnalysis } from "./fake-analysis.js";
import { FakeBaselineRepository } from "./fake-baseline-repository.js";
import { FakeClock } from "./fake-clock.js";
import { FakeConfigRepository } from "./fake-config-repository.js";
import { FakeConfirm } from "./fake-confirm.js";
import { FakeDescriber } from "./fake-describer.js";
import { FakeDigest } from "./fake-digest.js";
import { FakeFindingsRepository } from "./fake-findings-repository.js";
import { FakeGit } from "./fake-git.js";
import { FakeParsing } from "./fake-parsing.js";
import { FakePolicyRepository } from "./fake-policy-repository.js";
import { FakeProcess } from "./fake-process.js";
import { FakeRunLogRepository } from "./fake-run-log-repository.js";
import { FakeScanLock } from "./fake-scan-lock.js";
import { FakeScanners } from "./fake-scanners.js";
import { FakeSensors } from "./fake-sensors.js";
import { FakeSourceFiles } from "./fake-source-files.js";
import { FakeStructureRepository } from "./fake-structure-repository.js";

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
  };
}

export function portsOf(fakes: Fakes): ScanPorts {
  return { ...fakes };
}

export function scanOver(fakes: Fakes): Scan {
  return createScan(portsOf(fakes));
}
