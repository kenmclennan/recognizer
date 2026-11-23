import type { ConfigRepository } from "../../../domain/config-repository.js";
import type { FindingsRepository } from "../../../domain/findings-repository.js";
import type { PolicyRepository } from "../../../domain/policy-repository.js";
import type { Clock } from "../../shared/ports/clock.js";
import type { Analysis } from "../ports/analysis.js";
import type { Digest } from "../ports/digest.js";
import type { Parsing } from "../ports/parsing.js";
import type { SourceFiles } from "../ports/source-files.js";

export interface AnalysisPorts {
  analysis: Analysis;
  config: ConfigRepository;
  findings: FindingsRepository;
  policy: PolicyRepository;
  clock: Clock;
  source: SourceFiles;
  digest: Digest;
  parsing: Parsing;
}
