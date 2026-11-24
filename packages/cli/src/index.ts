import {
  type ApplyEvent as CoreApplyEvent,
  buildChanges as coreBuildChanges,
  type DoctorReport,
  type SetupChoices,
  type Survey,
} from "@recognizer/core";
import { shippedDescriberName } from "./adapters/plugins/shipped-plugins-adapter.js";

export {
  afterFoldToggle,
  afterPanelOpen,
  afterSensorTick,
  afterSuiteTick,
  type BaselineEntry,
  type BuiltChanges,
  bodyLength,
  type ChangeGroup,
  type ChangeStep,
  type CheckResult,
  type Citation,
  COMPLEXITY_LIMIT,
  type Condition,
  carryMeasured,
  commandRefusal,
  compareIdentities,
  complexityUnmeasured,
  createPlanner,
  type DoctorReport,
  type DroppedCard,
  type DroppedRunner,
  describeGap,
  duplicationUnmeasured,
  EMPTY_SUITE_TICKS,
  type EntryCard,
  type FindingEntry,
  type FindingNote,
  type ForbidCard,
  findingsByModuleFrom,
  freshnessScope,
  functionLength,
  gapOf,
  type Identity,
  type IgnoreCard,
  identityKey,
  importText,
  interpretManifest,
  judgeProtocol,
  LIBRARY_API_HINT,
  type LineKind,
  LONG_FUNCTION,
  libraryApiHint,
  linesDuplicated,
  type Manifest,
  type ManifestRead,
  type ModuleAnalysis as Analysis,
  type ModuleMetrics,
  matchKind,
  measuredInputs,
  measuredLength,
  measuredModules,
  measureFolders,
  measureModules as analyse,
  modulesWithFunctions,
  narrowViolationRecord,
  onlyArmed,
  orderDuplication,
  type PlanFacts,
  type PlanMode,
  type PlannedChange,
  type PlanningPorts,
  type PlanRequest,
  type PlanRow,
  type PluginEvent,
  type PluginKind,
  POLICY_RECOMMENDATION_PROMPT,
  POLICY_RECOMMENDATION_SCHEMA,
  type PolicyCard,
  PRINCIPLES,
  type Principle,
  type ProtocolJudgement,
  parseCard,
  planFor,
  planScan,
  policyCommands,
  principleName,
  principleOf,
  quoteCommand,
  type Recommendation,
  type ResponsibilityKinds,
  type RunnerChoice,
  rankAgainstBaseline,
  renderSentence,
  ruleText,
  type ScanIntent,
  type ScanPlanView,
  type ScanTicks,
  type SensorFreshness,
  type SensorRow,
  type Sentence,
  type SentenceRecord,
  type SetupChoices,
  type SetupMark,
  type SetupProblem,
  type ShippedSensorEntry,
  type StructureSettings,
  type SuiteRef,
  type SuiteTickEntry,
  type Survey,
  type SurveyCheck,
  type SurveyFix,
  type SurveyLanguage,
  type SurveyLimit,
  type SurveyNote,
  type SurveyPolicy,
  type SurveyRunner,
  type SurveySuite,
  type SurveyTool,
  type SurveyUnread,
  senseStructure as structureSensor,
  sensorArmed,
  sensorFreshness,
  sensorTickState,
  sentenceProblems,
  splitCommand,
  staleModules,
  suiteIsTicked,
  suitePlan,
  suitesForSense,
  summaryOf,
  type TickState,
  type TryEvent,
  tickedPhases,
  tickedSuites,
  UNREGISTERED_FIX,
  unregisteredMessage,
  unregisteredSensors,
  unusedTestOnlySentence,
  type Variant,
  violationId,
  violationText,
  visibleSuiteTicks,
  workOf,
} from "@recognizer/core";
export {
  parseBaseline,
  serialiseBaseline,
} from "./adapters/filesystem/baseline-adapter.js";
export {
  diagnosisDocumentOf,
  diagnosisOf,
  readDiagnosis,
} from "./adapters/filesystem/diagnosis-translator.js";
export {
  findingRecordOf,
  readSensorFindings,
  sensorFindingsDocument,
} from "./adapters/filesystem/findings-translator.js";
export { parsePolicy } from "./adapters/filesystem/policy-translator.js";
export { readRepository } from "./adapters/filesystem/scan-translator.js";
export {
  serialiseView,
  validateView,
} from "./adapters/filesystem/view-translator.js";
export {
  shippedDescriberInvocation,
  shippedSensorNames,
} from "./adapters/plugins/shipped-plugins-adapter.js";
export {
  AWAKE_GAP_MS,
  AWAKE_TICK_MS,
  type AwakeClock,
  createAwakeClock,
  systemAwakeClock,
} from "./awake-clock.js";
export {
  type ChangeClassification,
  changeMarks,
  classifyChanges,
  classifyOpened,
  type FileChange,
  type Mark,
  type MarkedFile,
  type MarkerCheck,
  type ParsedChanges,
  parseNameStatus,
  parseNameStatusLine,
  scannedBy,
  statusOf,
} from "./change-marks.js";
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
export { PRICES_PER_MILLION, priceFor } from "./describe-projection.js";
export { describerVersion } from "./describer-version.js";
export { InputError } from "./errors.js";
export {
  type FolderMetrics,
  metricsLine,
  metricsTable,
} from "./folder-metrics.js";
export type { Fix, Gap } from "./gap.js";
export { gapText, isGap } from "./gap.js";
export { check } from "./library-check.js";
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
  type Overlay,
  validateOverlay,
} from "./overlays.js";
export { type PolicyProblem, policyProblems } from "./policy-problems.js";
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
  splitFindings,
} from "./result-freshness.js";
export type { RunEntry, RunPhase, RunRecord } from "./run-log.js";
export {
  judgeScanVersion,
  SCAN_BREAKING_VERSIONS,
  SCAN_SCHEMA_VERSION,
  type ScanVersionVerdict,
  validateAcceptedScan,
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
} from "./scan-phases.js";
export type ApplyEvent = CoreApplyEvent<DoctorReport>;
export const buildChanges = (survey: Survey, choices: SetupChoices) =>
  coreBuildChanges(survey, choices, shippedDescriberName());
export { SETUP_SKILL } from "./skills.js";
export { resolveStructureSettings } from "./structure-sensor.js";
