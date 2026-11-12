import type { ScanRunRecord } from "recognizer";
import type { ScanPlan, ScanTicks } from "./scan-panel-model";
import type { ScanReport } from "./scan-report";

export type ScanRunResult =
  | { status: "finished"; exitCode: 0 | 1 }
  | { status: "stopped" }
  | { status: "command-missing"; hint: string }
  | { status: "failed"; exitCode: number; stderr: string }
  | { status: "refused"; reason: string }
  | { status: "gaps"; gaps: ScanRunRecord["gaps"] };

export type StoredTicks = {
  describe: boolean;
  sensors: boolean;
  ticked: string[] | null;
  onlyView?: boolean;
  remembered: boolean;
  suites?: ScanTicks["suites"];
  folds?: string[];
};

export type WrittenTicks = Omit<ScanTicks, "ticked" | "once"> & {
  ticked: string[];
};

export type DescribingSettings = {
  model: string;
  batchSize: number;
  confirmAboveUsd: number;
};

export type RunEvent =
  | { kind: "run"; run: ScanRunRecord | null }
  | { kind: "line"; line: string };

export type ScanPort = {
  run(plan: ScanPlan): Promise<ScanRunResult>;
  stop(): Promise<void>;
  answerDescribe(describe: boolean): Promise<void>;
  readCache(): Promise<ScanReport>;
  readTicks(): Promise<StoredTicks>;
  writeTicks(ticks: WrittenTicks): Promise<void>;
  readDescribing(): Promise<DescribingSettings>;
  watchExternal(): Promise<void>;
  onRun(handler: (event: RunEvent) => void): () => void;
};

export const inertScan: ScanPort = {
  run: async () => ({ status: "finished", exitCode: 0 }),
  stop: async () => {},
  answerDescribe: async () => {},
  readCache: async () => ({
    status: "scanned",
    exitCode: 0,
    stderr: "",
    scans: [],
    policy: null,
  }),
  readTicks: async () => ({
    describe: false,
    sensors: false,
    ticked: null,
    remembered: false,
    suites: {},
    folds: [],
  }),
  writeTicks: async () => {},
  readDescribing: async () => ({
    model: "haiku",
    batchSize: 4,
    confirmAboveUsd: 5,
  }),
  watchExternal: async () => {},
  onRun: () => () => {},
};
