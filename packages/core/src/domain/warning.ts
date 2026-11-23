import { InvalidEntity } from "./invalid-entity.js";

export interface WarningDependency {
  readonly from: string;
  readonly to: string;
}

export class Warning {
  readonly kind = "cycle" as const;
  readonly principle = "levelization" as const;
  readonly fixPattern = "break-cycle" as const;
  readonly summary: string;
  readonly files: readonly string[];
  readonly dependencies: readonly WarningDependency[];

  constructor(fields: {
    readonly summary: string;
    readonly files: readonly string[];
    readonly dependencies: readonly WarningDependency[];
  }) {
    if (fields.files.length === 0) {
      throw new InvalidEntity(
        "Warning",
        "a warning has at least one file",
        fields.summary,
      );
    }

    this.summary = fields.summary;
    this.files = fields.files;
    this.dependencies = fields.dependencies;
  }
}
