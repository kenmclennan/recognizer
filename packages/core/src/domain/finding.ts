import { InvalidEntity } from "./invalid-entity.js";
import type { ViolatedRule } from "./policy-rule.js";
import type { Repository } from "./repository.js";

export interface Citation {
  readonly author: string;
  readonly work: string;
  readonly year: number;
  readonly locator?: string;
}

export interface FindingDependency {
  readonly from: string;
  readonly to: string;
  readonly kind?: string;
  readonly lines?: readonly number[];
  readonly rules?: readonly ViolatedRule[];
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

export interface FindingFields {
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

export class Finding {
  readonly id: string;
  readonly kind: string;
  readonly severity: "violation" | "warning";
  readonly principle: string;
  declare readonly citation?: Citation;
  readonly summary: string;
  declare readonly fixPattern?: string;
  declare readonly metric?: string;
  readonly files: readonly string[];
  declare readonly dependencies?: readonly FindingDependency[];
  declare readonly members?: readonly FindingMember[];
  declare readonly measures?: Readonly<Record<string, number>>;
  declare readonly testImporters?: readonly TestImporter[];
  declare readonly producer?: string;

  private constructor(fields: FindingFields) {
    this.id = fields.id;
    this.kind = fields.kind;
    this.severity = fields.severity;
    this.principle = fields.principle;
    this.summary = fields.summary;
    this.files = fields.files;

    if (fields.citation !== undefined) this.citation = fields.citation;
    if (fields.fixPattern !== undefined) this.fixPattern = fields.fixPattern;
    if (fields.metric !== undefined) this.metric = fields.metric;
    if (fields.dependencies !== undefined) {
      this.dependencies = fields.dependencies;
    }
    if (fields.members !== undefined) this.members = fields.members;
    if (fields.measures !== undefined) this.measures = fields.measures;
    if (fields.testImporters !== undefined) {
      this.testImporters = fields.testImporters;
    }
    if (fields.producer !== undefined) this.producer = fields.producer;
  }

  static about(repository: Repository, fields: FindingFields): Finding {
    const missing = repository.missingTargetsOf(fields);

    if (missing.length > 0) {
      throw new InvalidEntity(
        "Finding",
        "names a file or member the repository lacks",
        missing.join(", "),
      );
    }

    return new Finding(fields);
  }

  static stored(fields: FindingFields): Finding {
    return new Finding(fields);
  }

  with(changes: Partial<FindingFields>): Finding {
    return new Finding({ ...this, ...changes });
  }

  touches(path: string): boolean {
    return this.files.includes(path);
  }
}
