import type {
  DescribeResult,
  PluginProgress,
  Projection,
  RunEntry,
} from "../../domain/index.js";
import type { Say, ScanDocument } from "./opaque.js";

export interface DescriberRef {
  readonly describerRef: true;
}

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

export interface Describer {
  locate(root: string): LocatedDescriber;
  refuseShipped(located: LocatedDescriber): void;
  settings(): { model: string; batchSize: number };
  describe(call: DescribeCall): Promise<DescribeResult>;
}
