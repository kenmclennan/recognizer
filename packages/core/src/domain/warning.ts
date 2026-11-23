import {
  Finding,
  type FindingDependency,
  type FindingMember,
  type TestImporter,
} from "./finding.js";
import { InvalidEntity } from "./invalid-entity.js";
import { principleOf } from "./principles.js";

export type WarningKind =
  | "cycle"
  | "orphan"
  | "unused_exports"
  | "private_imports"
  | "long_function"
  | "duplication"
  | "complexity";

export const WARNING_KINDS: readonly WarningKind[] = [
  "cycle",
  "orphan",
  "unused_exports",
  "private_imports",
  "long_function",
  "duplication",
  "complexity",
];

export interface WarningFields {
  readonly kind: WarningKind;
  readonly id: string;
  readonly principle: string;
  readonly summary: string;
  readonly files: readonly string[];
  readonly fixPattern?: string;
  readonly dependencies?: readonly FindingDependency[];
  readonly members?: readonly FindingMember[];
  readonly measures?: Readonly<Record<string, number>>;
  readonly testImporters?: readonly TestImporter[];
}

export class Warning {
  readonly kind: WarningKind;
  readonly id: string;
  readonly principle: string;
  readonly summary: string;
  readonly files: readonly string[];
  declare readonly fixPattern?: string;
  declare readonly dependencies?: readonly FindingDependency[];
  declare readonly members?: readonly FindingMember[];
  declare readonly measures?: Readonly<Record<string, number>>;
  declare readonly testImporters?: readonly TestImporter[];

  constructor(fields: WarningFields) {
    if (fields.files.length === 0) {
      throw new InvalidEntity(
        "Warning",
        "a warning has at least one file",
        fields.summary,
      );
    }

    if (!fields.id.startsWith(`${fields.kind}:`)) {
      throw new InvalidEntity(
        "Warning",
        "a warning id starts with its kind",
        fields.id,
      );
    }

    this.kind = fields.kind;
    this.id = fields.id;
    this.principle = fields.principle;
    this.summary = fields.summary;
    this.files = fields.files;

    if (fields.fixPattern !== undefined) this.fixPattern = fields.fixPattern;
    if (fields.dependencies !== undefined) {
      this.dependencies = fields.dependencies;
    }
    if (fields.members !== undefined) this.members = fields.members;
    if (fields.measures !== undefined) this.measures = fields.measures;
    if (fields.testImporters !== undefined) {
      this.testImporters = fields.testImporters;
    }
  }

  toFinding(): Finding {
    return Finding.stored({
      id: this.id,
      kind: this.kind,
      severity: "warning",
      ...principleOf(this.principle),
      summary: this.summary,
      ...(this.fixPattern !== undefined ? { fixPattern: this.fixPattern } : {}),
      files: this.files,
      ...(this.dependencies !== undefined
        ? { dependencies: this.dependencies }
        : {}),
      ...(this.members !== undefined ? { members: this.members } : {}),
      ...(this.measures !== undefined ? { measures: this.measures } : {}),
      ...(this.testImporters !== undefined
        ? { testImporters: this.testImporters }
        : {}),
    });
  }

  static ofFinding(finding: Finding): Warning | null {
    if (
      !(WARNING_KINDS as readonly string[]).includes(finding.kind) ||
      finding.files.length === 0 ||
      finding.severity !== "warning" ||
      !finding.id.startsWith(`${finding.kind}:`)
    ) {
      return null;
    }

    return new Warning({
      kind: finding.kind as WarningKind,
      id: finding.id,
      principle: finding.principle,
      summary: finding.summary,
      files: finding.files,
      ...(finding.fixPattern !== undefined
        ? { fixPattern: finding.fixPattern }
        : {}),
      ...(finding.dependencies !== undefined
        ? {
            dependencies:
              finding.kind === "cycle"
                ? finding.dependencies.map(({ from, to }) => ({ from, to }))
                : finding.dependencies,
          }
        : {}),
      ...(finding.members !== undefined ? { members: finding.members } : {}),
      ...(finding.measures !== undefined ? { measures: finding.measures } : {}),
      ...(finding.testImporters !== undefined
        ? { testImporters: finding.testImporters }
        : {}),
    });
  }
}
