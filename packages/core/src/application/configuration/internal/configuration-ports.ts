import type { AssistantText } from "../../../domain/assistant-text.js";
import type { ConfigRepository } from "../../../domain/config-repository.js";
import type { LanguageRule } from "../../../domain/language-rule.js";
import type { PolicyRepository } from "../../../domain/policy-repository.js";
import type { Repository } from "../../../domain/repository.js";
import type { diagnose } from "../../plugins/diagnose.js";
import type { Clock } from "../../shared/ports/clock.js";
import type { RepositoryFiles } from "../../shared/ports/repository-files.js";
import type { ScanLock } from "../../shared/ports/scan-lock.js";
import type { Assistant } from "../ports/assistant.js";
import type { ConfigKeys } from "../ports/config-keys.js";
import type { KeyOwners } from "../ports/key-owners.js";
import type { KeyedText } from "../ports/keyed-text.js";
import type { SetupFiles } from "../ports/setup-files.js";
import type { SetupPrograms } from "../ports/setup-programs.js";
import type { SetupScan } from "../ports/setup-scan.js";
import type { SurveyPlugins } from "../ports/survey-plugins.js";

export type SetupDoctorReport = ReturnType<typeof diagnose>;

export interface InstalledCheck {
  name: string;
  display: string;
  description?: string;
  runs_tests: boolean;
  assistant?: AssistantText;
}

export interface SetupReads {
  languageRules(): LanguageRule[];
  cachedScans(root: string): Repository | null;
  sensors(): InstalledCheck[];
  describers(): InstalledCheck[];
  diagnose(root: string): SetupDoctorReport;
}

export interface ConfigurationPorts {
  files: SetupFiles;
  listing: RepositoryFiles;
  plugins: SurveyPlugins;
  assistant: Assistant;
  scan: SetupScan;
  keys: ConfigKeys;
  keyedText: KeyedText;
  keyOwners: KeyOwners;
  config: ConfigRepository;
  policy: PolicyRepository;
  programs: SetupPrograms;
  lock: ScanLock;
  clock: Clock;
  reads: SetupReads;
  version: string;
}
