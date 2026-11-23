import type { ConfigRepository } from "../../../domain/config-repository.js";
import type { FindingsRepository } from "../../../domain/findings-repository.js";
import type { PolicyRepository } from "../../../domain/policy-repository.js";
import type { Clock } from "../../shared/ports/clock.js";
import type { Analysis } from "../ports/analysis.js";

export interface AnalysisPorts {
  analysis: Analysis;
  config: ConfigRepository;
  findings: FindingsRepository;
  policy: PolicyRepository;
  clock: Clock;
}
