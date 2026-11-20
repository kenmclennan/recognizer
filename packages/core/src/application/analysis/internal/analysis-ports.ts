import type { Clock } from "../../shared/ports/clock.js";
import type { Store } from "../../shared/ports/store.js";
import type { Analysis } from "../ports/analysis.js";

export interface AnalysisPorts {
  analysis: Analysis;
  store: Store;
  clock: Clock;
}
