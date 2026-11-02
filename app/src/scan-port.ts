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
  measure: boolean;
  overlays: string[] | null;
  sensors: boolean;
  ticked: string[] | null;
  remembered: boolean;
};

export type WrittenTicks = Omit<ScanTicks, "ticked" | "overlays"> & {
  ticked: string[];
  overlays: string[];
};

export type ScanPort = {
  run(plan: ScanPlan): Promise<ScanRunResult>;
  stop(): Promise<void>;
  readCache(): Promise<ScanReport>;
  readTicks(): Promise<StoredTicks>;
  writeTicks(ticks: WrittenTicks): Promise<void>;
  onLine(handler: (line: string) => void): () => void;
};

export const inertScan: ScanPort = {
  run: async () => ({ status: "finished", exitCode: 0, stderr: "", log: null }),
  stop: async () => {},
  readCache: async () => ({
    status: "scanned",
    exitCode: 0,
    stderr: "",
    scans: [],
    policy: null,
  }),
  readTicks: async () => ({
    describe: false,
    measure: false,
    overlays: null,
    sensors: false,
    ticked: null,
    remembered: false,
  }),
  writeTicks: async () => {},
  onLine: () => () => {},
};
