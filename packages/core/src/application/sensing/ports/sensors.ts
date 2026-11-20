import type { ConfigDocument } from "../../../domain/config-document.js";
import type { Gap } from "../../../domain/gap.js";
import type { RunEntry } from "../../../domain/run-record.js";
import type { ScanDocument } from "../../../domain/scan-document.js";
import type { PluginProgress } from "../../../domain/scan-event.js";
import type { SensorRequest } from "../../../domain/scan-request.js";
import type { PluginLimits, Say } from "../../shared/ports/process.js";

export interface SensorSelectionInput {
  root: string;
  config: ConfigDocument | null;
  limits: PluginLimits;
  sense: null | "all" | SensorRequest[];
}

export interface SensorSelection {
  readonly sensorSelection: true;
}

export interface SensorPlanInput {
  selection: SensorSelection;
  sense: null | "all" | SensorRequest[];
  config: ConfigDocument | null;
  suitesFile: string | undefined;
  modulesFile: string | undefined;
}

export interface PlannedSensor {
  name: string;
  command: string[];
  runsTests: boolean;
  scoped: boolean;
}

export interface SensorPlan {
  selected: PlannedSensor[];
  chosen: Record<string, string[]>;
}

export interface CommitGapsInput {
  commit: string | null;
  sensors: { name: string; command: string[] }[];
}

export interface ProgramGapsInput {
  sensors: { name: string; command: string[] }[];
  install: Record<string, string>;
}

export interface SenseCall {
  root: string;
  selected: (PlannedSensor & { modules?: number })[];
  commit: string;
  scans: ScanDocument[];
  limits: PluginLimits;
  onStart: (name: string) => void;
  onEvent: (name: string, event: PluginProgress) => void;
  onEntry: (entry: RunEntry) => void;
  say: Say;
}

export interface Sensors {
  select(input: SensorSelectionInput): SensorSelection;
  plan(input: SensorPlanInput): SensorPlan;
  commitGaps(input: CommitGapsInput): Gap[];
  programGaps(input: ProgramGapsInput): Gap[];
  readinessGaps(
    root: string,
    sensors: { name: string; command: string[] }[],
    limits: PluginLimits,
  ): Gap[];
  run(call: SenseCall): Promise<void>;
}
