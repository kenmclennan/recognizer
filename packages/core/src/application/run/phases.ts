import type { ConfigDocument } from "../../domain/config-document.js";
import type { Gap } from "../../domain/gap.js";
import type {
  AnalyseStructureInput,
  StructureOutcome,
} from "../analysis/analyse-structure.js";
import type {
  DescribeFilesInput,
  DescribeOutcome,
} from "../describing/describe-files.js";
import type { DescribingSettings } from "../describing/describing-settings.js";
import type { FindDescriberGapsInput } from "../describing/find-describer-gaps.js";
import type { LocatedDescriber } from "../describing/locate-describer.js";
import type { DetectLanguagesInput } from "../scanning/detect-languages.js";
import type { ScannerDiscovery } from "../scanning/discover-scanners.js";
import type {
  ExtractOutcome,
  ExtractScansInput,
} from "../scanning/extract-scans.js";
import type { ScannerSetup } from "../scanning/read-scanner-setup.js";
import type { CommitGapsInput } from "../sensing/find-commit-gaps.js";
import type { ProgramGapsInput } from "../sensing/find-program-gaps.js";
import type { ReadinessInput } from "../sensing/find-readiness-gaps.js";
import type { SensorPlan, SensorPlanInput } from "../sensing/plan-sensors.js";
import type { RunSensorsInput } from "../sensing/run-sensors.js";
import type {
  SensorSelection,
  SensorSelectionInput,
} from "../sensing/select-sensors.js";

export interface RunPhases {
  discoverScanners(): ScannerDiscovery;
  readScannerSetup(root: string): ScannerSetup;
  readRunConfig(root: string, skipRetired: boolean): ConfigDocument | null;
  locateDescriber(root: string): LocatedDescriber;
  selectSensors(input: SensorSelectionInput): SensorSelection;
  refuseShippedDescriber(located: LocatedDescriber): void;
  planSensors(input: SensorPlanInput): SensorPlan;
  detectLanguages(input: DetectLanguagesInput): string[];
  describingSettings(): DescribingSettings;
  findCommitGaps(input: CommitGapsInput): Gap[];
  findDescriberGaps(input: FindDescriberGapsInput): Gap[];
  findProgramGaps(input: ProgramGapsInput): Gap[];
  isDescriberRegistered(located: LocatedDescriber): boolean;
  findReadinessGaps(input: ReadinessInput): Gap[];
  extractScans(
    input: ExtractScansInput,
  ): Promise<ExtractOutcome> | ExtractOutcome;
  analyseStructure(
    input: AnalyseStructureInput,
  ): Promise<StructureOutcome> | StructureOutcome;
  describeFiles(input: DescribeFilesInput): Promise<DescribeOutcome>;
  runSensors(input: RunSensorsInput): Promise<void>;
}
