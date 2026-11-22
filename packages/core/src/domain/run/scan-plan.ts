import type { ScanIntent, ScanTicks } from "../scan-plan.js";

export type PlanMode = "bring" | "rescan";

export type PlanRequest = {
  repository: string;
  mode: PlanMode;
  ticks: ScanTicks;
  scope: string[] | null;
  changed: string[];
};

export type ScanPlanView = {
  intent: ScanIntent;
  dropped: string[];
  modules: number;
  idle: boolean;
  work: Record<string, number>;
  gaps: Record<string, string[]>;
  never: string[];
};
