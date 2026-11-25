import type { FreshnessView } from "./result-freshness.js";
import type { ResultsView } from "./result-set.js";
import type { RunView } from "./run.js";
import type { SensorRegistryView } from "./sensor-registry.js";

export type { FreshnessView, ResultsView, RunView, SensorRegistryView };

export interface RepositoryState {
  repository: string;
  revision: number;
  registry: SensorRegistryView;
  run: RunView | null;
  results: Record<string, ResultsView>;
  freshness: Record<string, FreshnessView>;
  unreadableReports: number;
  inputsDigest: string;
}
