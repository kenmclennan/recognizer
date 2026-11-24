import type { Limiter } from "../shared/limiter.js";
import type { Git } from "../shared/ports/git.js";
import type { RecordedScans } from "./ports/recorded-scans.js";
import type { WorkTree } from "./ports/work-tree.js";

export interface ScanBaselinePorts {
  readonly git: Git;
  readonly recordedScans: RecordedScans;
  readonly workTree: WorkTree;
  readonly limiter: Limiter;
}
