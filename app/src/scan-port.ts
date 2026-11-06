import type { ScanPlan, ScanTicks } from "./scan-panel-model";
import type { ScanReport } from "./scan-report";

export type ScanRunResult =
  | { status: "finished"; exitCode: 0 | 1; stderr: string; log: string | null }
  | { status: "stopped" }
  | { status: "command-missing"; hint: string }
  | { status: "failed"; exitCode: number; stderr: string }
  | { status: "refused"; reason: string };

export type StoredTicks = {
  describe: boolean;
  sensors: boolean;
  ticked: string[] | null;
  onlyView?: boolean;
  remembered: boolean;
};

export type WrittenTicks = Omit<ScanTicks, "ticked" | "once"> & {
  ticked: string[];
};

export type DescribingSettings = {
  model: string;
  batchSize: number;
  confirmAboveUsd: number;
};

export type ScanPort = {
  run(plan: ScanPlan): Promise<ScanRunResult>;
  stop(): Promise<void>;
  answerDescribe(describe: boolean): Promise<void>;
  readCache(): Promise<ScanReport>;
  readTicks(): Promise<StoredTicks>;
  writeTicks(ticks: WrittenTicks): Promise<void>;
  readDescribing(): Promise<DescribingSettings>;
  onLine(handler: (line: string) => void): () => void;
};

export const inertScan: ScanPort = {
  run: async () => ({ status: "finished", exitCode: 0, stderr: "", log: null }),
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
  }),
  writeTicks: async () => {},
  readDescribing: async () => ({
    model: "haiku",
    batchSize: 4,
    confirmAboveUsd: 5,
  }),
  onLine: () => () => {},
};
