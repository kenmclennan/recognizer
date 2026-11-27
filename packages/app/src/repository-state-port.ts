import type {
  DocumentFreshness,
  Finding,
  RepositoryState,
  SensorFindingsHeader,
  SuiteStanding,
} from "@recognizer/core";
import type { Overlay } from "recognizer";
import type { Refusal } from "./sensor-run";

export type RepositoryStateItem = {
  stream: string;
  state: RepositoryState;
};

export type PluginResults = {
  findings: SensorFindingsHeader | null;
  overlay: Overlay | null;
  findingsProblem: string | null;
  overlayProblem: string | null;
  modifiedMs: number | null;
  freshness: DocumentFreshness | null;
  measured: string[] | null;
  shown: Finding[] | null;
  hidden: Finding[] | null;
  suites: SuiteStanding[] | null;
};

export type ResultDocuments = {
  revision: number;
  plugins: Record<string, PluginResults>;
  refusals: Record<string, Refusal>;
  lastRun: string | null;
};

export type RepositoryStatePort = {
  watch(handler: (item: RepositoryStateItem) => void): Promise<() => void>;
  readResults(tests?: string | null): Promise<ResultDocuments>;
  clearResults(plugin: string): Promise<void>;
};
