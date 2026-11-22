import type { ConfigDocument } from "../../../domain/config-document.js";
import type { PolicyDocument } from "../../../domain/policy-document.js";
import type { ScanDocument } from "../../../domain/scan-document.js";
import type { Say } from "../../shared/ports/process.js";

export interface ParserSet {
  readonly parserSet: true;
}

export interface AnalysisPlan {
  readonly analysisPlan: true;
}

export interface Analysis {
  readonly name: string;
  analysisPlan(config: ConfigDocument | null): AnalysisPlan | "off";
  analysisPrepare(
    plan: AnalysisPlan,
    root: string,
    scans: ScanDocument[],
    policy: PolicyDocument,
    say: Say,
  ): { parserLanguages: string[] | null; label: string };
  loadParsers(languages: string[]): Promise<ParserSet>;
  analysisRun(
    plan: AnalysisPlan,
    root: string,
    scans: ScanDocument[],
    policy: PolicyDocument,
    parsers: ParserSet | null,
    say: Say,
  ): { error: string | null };
}
