import type {
  Analysis,
  ConfigDocument,
  ParserSet,
  PolicyDocument,
  ScanDocument,
  StructurePlan,
} from "../../src/index.js";

export class FakeAnalysis implements Analysis {
  readonly structureParsers: (ParserSet | null)[] = [];
  structure: { enabled: boolean; parserLanguages: string[] | null } = {
    enabled: false,
    parserLanguages: null,
  };

  structurePlan(_config: ConfigDocument | null): StructurePlan | "off" {
    return this.structure.enabled ? { structurePlan: true } : "off";
  }

  structurePrepare(
    _plan: StructurePlan,
    _root: string,
    _scans: ScanDocument[],
    _policy: PolicyDocument,
  ): { parserLanguages: string[] | null; label: string } {
    return {
      parserLanguages: this.structure.parserLanguages,
      label: "structure",
    };
  }

  loadParsers(): Promise<ParserSet> {
    return Promise.resolve({ parserSet: true });
  }

  structureRun(
    _plan: StructurePlan,
    _root: string,
    _scans: ScanDocument[],
    _policy: PolicyDocument,
    parsers: ParserSet | null,
  ): { error: string | null } {
    this.structureParsers.push(parsers);

    return { error: null };
  }
}
