export {
  type Analysis,
  analyse,
  type ModuleMetrics,
  type Thresholds,
  type Warning,
} from "./analyse.js";
export {
  type Identity,
  identityKey,
  parseBaseline,
  serialiseBaseline,
} from "./baseline.js";
export {
  buildCallerIndex,
  type Caller,
  type CallerIndex,
  type CallerSummary,
} from "./callers.js";
export { type CheckResult, check } from "./check.js";
export { type Config, parseConfig } from "./config-parse.js";
export { InputError } from "./errors.js";
export {
  type Finding,
  findingsByModule,
  ruleText,
  violationText,
} from "./findings.js";
export {
  edgeNames,
  type FolderGroup,
  folderChain,
  folderCounts,
  folderOf,
  folderUsedBy,
  folderUses,
  groupByFolder,
  lastSegment,
  membersOf,
  moduleCounts,
  moduleLabel,
  moduleNames,
  type NeighbourCounts,
  type NeighbourRow,
  type NeighbourSets,
  neighbourSets,
  under,
  usedByOf,
  usesOf,
} from "./neighbours.js";
export {
  type Overlay,
  validateOverlay,
} from "./overlays.js";
export { type PathStep, shortestPath } from "./paths.js";
export { type Policy, parsePolicy } from "./policy.js";
export {
  type LineStatus,
  lineStatus,
  type Responsibilities,
  type ResponsibilityEntry,
  validateResponsibilities,
} from "./responsibilities.js";
export type { Rule, Violation } from "./rules.js";
export { collectViolations } from "./rules.js";
export {
  SCAN_SCHEMA_VERSION,
  type Scan,
  type ScanCall,
  type ScanEdge,
  type ScanField,
  type ScanMember,
  type ScanMethod,
  validateScan,
} from "./scan.js";
export {
  type Note,
  type ResolvedView,
  resolveView,
  type View,
  type ViewStep,
  validateView,
} from "./views.js";
