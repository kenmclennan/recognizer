import { createScan, type Scan, type ScanPorts } from "../../src/index.js";
import { FakeAnalysis } from "./fake-analysis.js";
import { FakeClock } from "./fake-clock.js";
import { FakeConfirm } from "./fake-confirm.js";
import { FakeDescriber } from "./fake-describer.js";
import { FakeGit } from "./fake-git.js";
import { FakeProcess } from "./fake-process.js";
import { FakeScanners } from "./fake-scanners.js";
import { FakeSensors } from "./fake-sensors.js";
import { FakeStore } from "./fake-store.js";

export interface Fakes {
  scanners: FakeScanners;
  analysis: FakeAnalysis;
  sensors: FakeSensors;
  describer: FakeDescriber;
  git: FakeGit;
  store: FakeStore;
  confirm: FakeConfirm;
  clock: FakeClock;
  process: FakeProcess;
}

export function createFakes(commit: string | null = "c0ffee"): Fakes {
  const log: string[] = [];
  const store = new FakeStore();
  const sensors = new FakeSensors(log);
  const process = new FakeProcess();

  process.onStop(() => sensors.releaseHeld());

  return {
    scanners: new FakeScanners(store, log),
    analysis: new FakeAnalysis(),
    sensors,
    describer: new FakeDescriber(),
    git: new FakeGit(commit),
    store,
    confirm: new FakeConfirm(true),
    clock: new FakeClock(),
    process,
  };
}

export function portsOf(fakes: Fakes): ScanPorts {
  return { ...fakes };
}

export function scanOver(fakes: Fakes): Scan {
  return createScan(portsOf(fakes));
}
