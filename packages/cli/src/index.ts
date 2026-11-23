export {
  afterFoldToggle,
  afterPanelOpen,
  afterSensorTick,
  afterSuiteTick,
  type BaselineEntry,
  bodyLength,
  type CheckResult,
  type Citation,
  COMPLEXITY_LIMIT,
  carryMeasured,
  compareIdentities,
  complexityUnmeasured,
  createPlanner,
  describeGap,
  duplicationUnmeasured,
  EMPTY_SUITE_TICKS,
  type FindingNote,
  findingsByModuleFrom,
  freshnessScope,
  functionLength,
  gapOf,
  type Identity,
  identityKey,
  importText,
  LIBRARY_API_HINT,
  type LineKind,
  LONG_FUNCTION,
  libraryApiHint,
  linesDuplicated,
  type ModuleAnalysis as Analysis,
  type ModuleMetrics,
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
  type PlanningPorts,
  type PlanRequest,
  type PlanRow,
  PRINCIPLES,
  type Principle,
  planFor,
  planScan,
  principleName,
  principleOf,
  type ResponsibilityKinds,
  rankAgainstBaseline,
  ruleText,
  type ScanIntent,
  type ScanPlanView,
  type ScanTicks,
  type SensorFreshness,
  type SensorRow,
  type StructureSettings,
  type SuiteRef,
  type SuiteTickEntry,
  senseStructure as structureSensor,
  sensorArmed,
  sensorFreshness,
  sensorTickState,
  staleModules,
  suiteIsTicked,
  suitePlan,
  suitesForSense,
  type TickState,
  tickedPhases,
  tickedSuites,
  unusedTestOnlySentence,
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
export type { DoctorReport, SetupProblem } from "./doctor.js";
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
export type { PluginEvent } from "./plugin-events.js";
export {
  CURRENT_PROTOCOL,
  interpretManifest,
  judgeProtocol,
  type Manifest,
  type ManifestRead,
  type PluginKind,
  type ProtocolJudgement,
  readManifest,
} from "./plugin-manifest.js";
export {
  type Condition,
  type FindingEntry,
  matchKind,
  renderSentence,
  type Sentence,
  type SentenceRecord,
  sentenceProblems,
  type Variant,
} from "./plugin-sentence.js";
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
  parseSuiteSelection,
} from "./scan-phases.js";
export type { ApplyEvent } from "./setup-apply.js";
export {
  type DroppedCard,
  type EntryCard,
  type ForbidCard,
  type IgnoreCard,
  POLICY_RECOMMENDATION_SCHEMA,
  type PolicyCard,
  parseCard,
  policyCommands,
  type Recommendation,
  summaryOf,
} from "./setup-cards.js";
export {
  type BuiltChanges,
  buildChanges,
  type ChangeGroup,
  type ChangeStep,
  type DroppedRunner,
  type PlannedChange,
  type RunnerChoice,
  type SetupChoices,
  splitCommand,
} from "./setup-changes.js";
export { POLICY_RECOMMENDATION_PROMPT } from "./setup-policy-prompt.js";
export { commandRefusal, quoteCommand } from "./setup-proposal.js";
export type {
  SetupMark,
  Survey,
  SurveyCheck,
  SurveyFix,
  SurveyLanguage,
  SurveyLimit,
  SurveyNote,
  SurveyPolicy,
  SurveyRunner,
  SurveySuite,
  SurveyTool,
  SurveyUnread,
} from "./setup-survey.js";
export type { TryEvent } from "./setup-try.js";
export {
  SHIPPED_DESCRIBER_COMMAND,
  SHIPPED_DESCRIBER_NAME,
} from "./shipped-describer.js";
export {
  readShippedSensors,
  type ShippedSensorEntry,
  shippedSensorNames,
} from "./shipped-sensors.js";
export { SETUP_SKILL } from "./skills.js";
export { resolveStructureSettings } from "./structure-sensor.js";
export {
  UNREGISTERED_FIX,
  unregisteredMessage,
  unregisteredSensors,
} from "./unregistered-plugins.js";
