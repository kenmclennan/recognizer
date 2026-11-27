import type { AssistantText } from "../assistant-text.js";

export const SURVEY_VERSION = 1;

export type SetupMark = "set-up" | "new" | "gone";

export interface SurveyFolder {
  path: string;
  files: number;
}

export interface SurveyLanguage {
  language: string;
  files: number;
  folders: SurveyFolder[];
  mark: SetupMark | null;
}

export interface SurveyLimit {
  key: string;
  label: string;
  default: number;
  current: number | null;
}

export interface SurveyCheck {
  id: string;
  display: string;
  description: string;
  always_on: boolean;
  enabled: boolean;
  runs_tests: boolean;
  kind?: "sensor" | "describer";
  limits: SurveyLimit[];
  mark: SetupMark | null;
}

export interface SurveyRunner {
  name: string;
  language: string;
  runner: string;
  directory: string;
  from: string;
  command: string;
  coverage: { path: string; format: string };
  tool: string | null;
  env?: Record<string, string>;
  activate?: string;
  settings?: Record<string, string>;
}

export interface SurveyNote {
  language: string;
  directory: string;
  text: string;
}

export interface SurveyTool {
  name: string;
  kind: string;
  installed: boolean;
  why: string;
  needed_by: string[];
  installs: string;
  prepare?: string[][];
  command: string[];
  cwd: string;
  files?: string[];
  undo?: string[];
  undo_note?: string;
}

export interface SurveyFix {
  code: string;
  subject: string;
  title: string;
  line: string;
  fix_text: string;
  command: string | null;
}

export interface SurveySuite {
  name: string;
  language: string;
  directory: string;
  command: string;
  env?: Record<string, string>;
  mark: "set-up" | "gone";
}

export interface SurveyPolicy {
  present: boolean;
  uncovered: string[];
}

export interface Survey {
  survey_version: 1;
  version: string;
  repository: string;
  configured: boolean;
  files: SurveyLanguage[] | null;
  checks: SurveyCheck[];
  runners: SurveyRunner[];
  notes?: SurveyNote[];
  tools: SurveyTool[];
  fixes: SurveyFix[];
  suites: SurveySuite[];
  policy: SurveyPolicy;
  assistant?: AssistantText;
}
