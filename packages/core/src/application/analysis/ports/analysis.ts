import type { ConfigDocument } from "../../../domain/config-document.js";
import type { PolicyRule } from "../../../domain/policy-rule.js";
import type { Repository } from "../../../domain/repository.js";
import type { StructureSettings } from "../../../domain/structure-settings.js";
import type { Say } from "../../shared/ports/process.js";

export interface Analysis {
  readonly name: string;
  analysisPlan(config: ConfigDocument | null): StructureSettings | "off";
  reportPolicyProblems(
    root: string,
    repository: Repository,
    rules: readonly PolicyRule[] | null,
    say: Say,
    file?: string,
  ): void;
}
