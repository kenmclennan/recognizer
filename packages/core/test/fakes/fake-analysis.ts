import {
  type Analysis,
  type ConfigDocument,
  DEFAULT_STRUCTURE_SETTINGS,
  type PolicyRule,
  type Repository,
  type Say,
  type StructureSettings,
} from "../../src/index.js";

export class FakeAnalysis implements Analysis {
  readonly name = "analysis";
  readonly problems: string[] = [];
  analysis: { enabled: boolean } = { enabled: false };

  analysisPlan(_config: ConfigDocument | null): StructureSettings | "off" {
    return this.analysis.enabled ? DEFAULT_STRUCTURE_SETTINGS : "off";
  }

  reportPolicyProblems(
    _root: string,
    _repository: Repository,
    _rules: readonly PolicyRule[] | null,
    _say: Say,
    file?: string,
  ): void {
    this.problems.push(file ?? "");
  }
}
