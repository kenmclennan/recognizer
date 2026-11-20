import type { Gap } from "../../../domain/gap.js";
import type { RunEntry } from "../../../domain/run-record.js";
import type { ScanDocument } from "../../../domain/scan-document.js";
import type {
  DescribeResult,
  PluginProgress,
  Projection,
} from "../../../domain/scan-event.js";
import type { Say } from "../../shared/ports/process.js";
import type { DescriberRef } from "./describer-ref.js";

export interface LocatedDescriber {
  describer: DescriberRef | null;
  shipped: boolean;
}

export interface DescribeCall {
  root: string;
  scans: ScanDocument[];
  describer: DescriberRef;
  model: string;
  batchSize: number;
  selection: { kind: "all" | "stale"; within?: string[] };
  confirm?: (projection: Projection) => Promise<boolean>;
  onProjection: (projection: Projection) => void;
  onStart: (total: number) => void;
  onEvent: (name: string, event: PluginProgress) => void;
  onEntry: (entry: RunEntry) => void;
  say: Say;
}

export interface DescriberGapsInput {
  root: string;
  describe: boolean;
  describer: DescriberRef | null;
  install: Record<string, string>;
}

export interface Describer {
  locate(root: string): LocatedDescriber;
  refuseShipped(located: LocatedDescriber): void;
  gaps(input: DescriberGapsInput): Gap[];
  settings(): { model: string; batchSize: number };
  describe(call: DescribeCall): Promise<DescribeResult>;
}
