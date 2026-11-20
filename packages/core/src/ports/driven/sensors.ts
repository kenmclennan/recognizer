import type {
  Gap,
  PluginProgress,
  RunEntry,
  SensorRequest,
} from "../../domain/index.js";
import type { DescriberRef } from "./describer.js";
import type {
  ConfigDocument,
  ParserSet,
  PluginLimits,
  PolicyDocument,
  Say,
  ScanDocument,
} from "./opaque.js";

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

export interface EarlyGapsInput {
  root: string;
  commit: string | null;
  sensors: { name: string; command: string[] }[];
  describe: boolean;
  describer: DescriberRef | null;
  model: string;
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

export interface StructurePlan {
  readonly structurePlan: true;
}

export interface Sensors {
  select(input: SensorSelectionInput): SensorSelection;
  plan(input: SensorPlanInput): SensorPlan;
  earlyGaps(input: EarlyGapsInput): Gap[];
  readinessGaps(
    root: string,
    sensors: { name: string; command: string[] }[],
    limits: PluginLimits,
  ): Gap[];
  structurePlan(config: ConfigDocument | null): StructurePlan | "off";
  structurePrepare(
    plan: StructurePlan,
    root: string,
    scans: ScanDocument[],
    policy: PolicyDocument,
    say: Say,
  ): { parserLanguages: string[] | null; label: string };
  loadParsers(languages: string[]): Promise<ParserSet>;
  structureRun(
    plan: StructurePlan,
    root: string,
    scans: ScanDocument[],
    policy: PolicyDocument,
    parsers: ParserSet | null,
    say: Say,
  ): { error: string | null };
  run(call: SenseCall): Promise<void>;
}
