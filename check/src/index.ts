export {
  type Analysis,
  analyse,
  type ModuleMetrics,
  type Warning,
} from "./analyse.js";
export {
  type BaselineEntry,
  compareIdentities,
  type Identity,
  identityKey,
  parseBaseline,
  serialiseBaseline,
  violationId,
} from "./baseline.js";
export {
  buildCallerIndex,
  type Caller,
  type CallerIndex,
  type CallerSummary,
} from "./callers.js";
export {
  type ChangeClassification,
  changeMarks,
  classifyChanges,
  type FileChange,
  type Mark,
  type MarkedModule,
  type MarkScan,
  type ParsedChanges,
  parseNameStatus,
} from "./change-marks.js";
export { type CheckResult, check, rankAgainstBaseline } from "./check.js";
export {
  addSection,
  type EditOutcome,
  type Listing,
  listKeys,
  setValue,
  typedValue,
  unsetValue,
} from "./config-edit.js";
export {
  CORE_KEYS,
  findKey,
  type KeyEntry,
  type KeySchema,
  type PublishedKey,
  type PublishedKeys,
  parseKeySchema,
  publish,
} from "./config-keys.js";
export {
  type Config,
  parseConfig,
  registeredSensors,
  shippedSensorSettings,
  type TestSuite,
} from "./config-parse.js";
export { describerVersion } from "./describer-version.js";
export {
  carryDuplication,
  duplicationUnmeasured,
} from "./duplication/carry.js";
export { InputError } from "./errors.js";
export {
  type Finding,
  findingsByModuleFrom,
  linesDuplicated,
  orderDuplication,
  ruleText,
  violationText,
} from "./findings.js";
export {
  type FindingEdge,
  type FindingRecord,
  type FindingsDocument,
  type SuiteResult,
  type SuiteStatus,
  validateFindings,
} from "./findings-document.js";
export {
  type FolderMetrics,
  measureFolders,
  metricsLine,
  metricsTable,
} from "./folder-metrics.js";
export { functionLength, LONG_FUNCTION } from "./function-length.js";
export type { Fix, Gap } from "./gap.js";
export { gapText, isGap } from "./gap.js";
export { dependencyEdges } from "./graph.js";
export {
  checkLink,
  isLink,
  type Link,
  type LinkParse,
  parseLink,
} from "./link.js";
export { validateRunRecord } from "./log-document.js";
export {
  MEMBER_TEXT_LIMIT,
  type MemberFile,
  type MemberMarkKind,
  type MemberMarksInput,
  type MemberScan,
  memberMarks,
} from "./member-marks.js";
export {
  classHeadTokens,
  classHeritage,
  constantTokens,
  enumTokens,
  fieldTokens,
  functionTokens,
  interfaceHeadTokens,
  memberHeadTokens,
  methodTokens,
  type Token,
  type TokenRole,
  tokensText,
  typeAliasTokens,
  typeTokens,
  valueTokens,
} from "./member-tokens.js";
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
  appendNote,
  dropIndex,
  moveNote,
  NoteOrderError,
  type NotePlace,
  numberOf,
  placeNote,
  reorderNotes,
} from "./notes-order.js";
export {
  type Overlay,
  validateOverlay,
} from "./overlays.js";
export { type PathStep, shortestPath } from "./paths.js";
export { type Policy, parsePolicy } from "./policy.js";
export { type PolicyProblem, policyProblems } from "./policy-problems.js";
export {
  type Citation,
  PRINCIPLES,
  type Principle,
  principleName,
  principleOf,
} from "./principles.js";
export {
  type LineStatus,
  lineStatus,
  type Responsibilities,
  type ResponsibilityEntry,
  validateResponsibilities,
} from "./responsibilities.js";
export {
  buildFreshness,
  type Freshness,
  type Measured,
  moduleOf,
  namedModules,
  scanHashes,
  splitFindings,
} from "./result-freshness.js";
export type { Rule, Violation } from "./rules.js";
export { collectViolations } from "./rules.js";
export type { RunEntry, RunPhase, RunRecord } from "./run-log.js";
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
export type {
  RunFailure,
  RunGap,
  ScanRunPhase,
  ScanRunRecord,
} from "./scan-marker.js";
export {
  type IdlePhase,
  idlePhases,
  nothingRanText,
  parseScanArgs,
  parseSuiteSelection,
} from "./scan-phases.js";
export {
  parseProgressLine,
  type SensorProgress,
} from "./sensor-progress.js";
export type { Diagnosis, DiagnosisCode } from "./sensor-reason.js";
export { SHIPPED_DESCRIBER_COMMAND } from "./shipped-describer.js";
export { SHIPPED_SENSOR_LIST, shippedSensorNames } from "./shipped-sensors.js";
export {
  measuredInputs,
  measuredModules,
  resolveStructureSettings,
  type StructureSettings,
  structureSensor,
} from "./structure-sensor.js";
export {
  LIBRARY_API_HINT,
  libraryApiHint,
  unusedTestOnlySentence,
} from "./test-importers.js";
export {
  type ChangeFacts,
  type StaleReason,
  staleReasons,
  staleReasonText,
} from "./view-staleness.js";
export {
  type Ghost,
  isValidRef,
  migrateView,
  movesKind,
  type Note,
  noteWarnings,
  orderedStep,
  type ProposedKind,
  parseRange,
  type ResolvedMemberEntry,
  type ResolvedMembers,
  type ResolvedView,
  rangeText,
  resolveMembers,
  resolveView,
  serialiseView,
  type View,
  type ViewChange,
  type ViewNote,
  type ViewProposedChange,
  type ViewStep,
  validateView,
  viewMemberProposed,
  viewModuleProposed,
  viewNotes,
  viewProposed,
} from "./views.js";
