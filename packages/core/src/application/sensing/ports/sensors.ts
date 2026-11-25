import type { ConfigDocument } from "../../../domain/config-document.js";
import type { Repository } from "../../../domain/repository.js";
import type { RunEntry } from "../../../domain/run-record.js";
import type { RunScope } from "../../../domain/run-scope.js";
import type { PluginProgress } from "../../../domain/scan-event.js";
import type { SensorRequest } from "../../../domain/sensor-request.js";
import type { SensorReport } from "../../plugins/check-sensor.js";
import type { InstalledRead } from "../../plugins/installed-sensors.js";
import type { PluginLimits, Say } from "../../shared/ports/process.js";

export interface SensorSelectionInput {
  root: string;
  config: ConfigDocument | null;
  limits: PluginLimits;
  sense: null | "all" | SensorRequest[];
}

export interface SensorSelection {
  selected: { name: string; command: string[] }[];
  installed: InstalledRead;
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

export interface SenseCall {
  root: string;
  selected: (PlannedSensor & { modules?: number })[];
  commit: string;
  scope: RunScope;
  modified: boolean | null;
  repository: Repository;
  limits: PluginLimits;
  onStart: (name: string) => void;
  onEvent: (name: string, event: PluginProgress) => void;
  onEntry: (entry: RunEntry) => void;
  say: Say;
}

export interface Sensors {
  probe(
    program: string,
    args: string[],
  ): { started: boolean; status: number | null };
  readinessReports(
    root: string,
    sensors: { name: string; command: string[] }[],
    limits: PluginLimits,
  ): SensorReport[];
  run(call: SenseCall): Promise<void>;
}
