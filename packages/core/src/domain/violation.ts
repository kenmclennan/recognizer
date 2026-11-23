import { InvalidEntity } from "./invalid-entity.js";
import type { ViolatedRule } from "./policy-rule.js";

export interface ViolationDependency {
  readonly to: string;
  readonly kind: string;
  readonly lines: readonly number[];
}

export class Violation {
  readonly file: string;
  readonly rule: ViolatedRule;
  readonly dependencies: readonly ViolationDependency[];

  constructor(fields: {
    readonly file: string;
    readonly rule: ViolatedRule;
    readonly dependencies: readonly ViolationDependency[];
  }) {
    if (fields.dependencies.length === 0) {
      throw new InvalidEntity(
        "Violation",
        "a violation has at least one dependency",
        fields.file,
      );
    }

    for (const dependency of fields.dependencies) {
      const lines = dependency.lines;
      const ordered = lines.every(
        (line, index) => index === 0 || (lines[index - 1] as number) < line,
      );

      if (!ordered) {
        throw new InvalidEntity(
          "Violation",
          "lines are not sorted and de-duplicated",
          `${fields.file} -> ${dependency.to}: ${lines.join(",")}`,
        );
      }
    }

    this.file = fields.file;
    this.rule = fields.rule;
    this.dependencies = fields.dependencies;
  }

  narrowedTo(
    keep: (dependency: ViolationDependency, index: number) => boolean,
  ): Violation {
    return new Violation({
      file: this.file,
      rule: this.rule,
      dependencies: this.dependencies.filter(keep),
    });
  }
}
