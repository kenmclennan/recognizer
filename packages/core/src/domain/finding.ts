export interface Citation {
  readonly author: string;
  readonly work: string;
  readonly year: number;
  readonly locator?: string;
}

export type FindingRule =
  | {
      readonly type: "level";
      readonly fromLevel: string;
      readonly toLevel: string;
    }
  | {
      readonly type: "uses";
      readonly fromComponent: string;
      readonly toComponent: string;
    }
  | { readonly type: "forbid"; readonly pattern: string };

export interface FindingDependency {
  readonly from: string;
  readonly to: string;
  readonly kind?: string;
  readonly lines?: readonly number[];
  readonly rules?: readonly FindingRule[];
}

export interface FindingMember {
  readonly file: string;
  readonly name: string;
  readonly sourceFile?: string;
  readonly lines?: readonly [number, number];
  readonly testFiles?: readonly string[];
}

export interface TestImporter {
  readonly file: string;
  readonly names: readonly string[];
}

export interface Finding {
  readonly id: string;
  readonly kind: string;
  readonly severity: "violation" | "warning";
  readonly principle: string;
  readonly citation?: Citation;
  readonly summary: string;
  readonly fixPattern?: string;
  readonly metric?: string;
  readonly files: readonly string[];
  readonly dependencies?: readonly FindingDependency[];
  readonly members?: readonly FindingMember[];
  readonly measures?: Readonly<Record<string, number>>;
  readonly testImporters?: readonly TestImporter[];
  readonly producer?: string;
}
