import type {
  Analysis,
  AnalysisPlan,
  ConfigDocument,
  ParserSet,
  PolicyDocument,
  ScanDocument,
} from "../../src/index.js";

export class FakeAnalysis implements Analysis {
  readonly name = "analysis";
  readonly analysisParsers: (ParserSet | null)[] = [];
  analysis: { enabled: boolean; parserLanguages: string[] | null } = {
    enabled: false,
    parserLanguages: null,
  };

  analysisPlan(_config: ConfigDocument | null): AnalysisPlan | "off" {
    return this.analysis.enabled ? { analysisPlan: true } : "off";
  }

  analysisPrepare(
    _plan: AnalysisPlan,
    _root: string,
    _scans: ScanDocument[],
    _policy: PolicyDocument,
  ): { parserLanguages: string[] | null; label: string } {
    return {
      parserLanguages: this.analysis.parserLanguages,
      label: "analysis",
    };
  }

  loadParsers(): Promise<ParserSet> {
    return Promise.resolve({ parserSet: true });
  }

  analysisRun(
    _plan: AnalysisPlan,
    _root: string,
    _scans: ScanDocument[],
    _policy: PolicyDocument,
    parsers: ParserSet | null,
  ): { error: string | null } {
    this.analysisParsers.push(parsers);

    return { error: null };
  }
}
