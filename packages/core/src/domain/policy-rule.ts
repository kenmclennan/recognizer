import { compileGlob, type Matcher } from "./glob.js";
import { InvalidEntity } from "./invalid-entity.js";

export class ForbidRule {
  readonly type = "forbid" as const;
  readonly pattern: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly #from: readonly Matcher[];
  readonly #to: readonly Matcher[];

  constructor(fields: {
    readonly pattern: string;
    readonly from: readonly string[];
    readonly to: readonly string[];
  }) {
    if (fields.pattern === "") {
      throw new InvalidEntity(
        "PolicyRule",
        "a forbid rule has an empty pattern",
        fields.pattern,
      );
    }

    if (fields.from.length === 0 || fields.to.length === 0) {
      throw new InvalidEntity(
        "PolicyRule",
        "a forbid rule needs at least one from and one to",
        fields.pattern,
      );
    }

    this.pattern = fields.pattern;
    this.from = fields.from;
    this.to = fields.to;
    this.#from = fields.from.map(compileGlob);
    this.#to = fields.to.map(compileGlob);
  }

  forbids(from: string, to: string): boolean {
    return (
      this.#from.some((matches) => matches(from)) &&
      this.#to.some((matches) => matches(to))
    );
  }
}

export class IgnoreRule {
  readonly type = "ignore" as const;
  readonly glob: string;
  readonly #matches: Matcher;

  constructor(fields: { readonly glob: string }) {
    if (fields.glob === "") {
      throw new InvalidEntity(
        "PolicyRule",
        "an ignore rule has an empty glob",
        fields.glob,
      );
    }

    this.glob = fields.glob;
    this.#matches = compileGlob(fields.glob);
  }

  ignores(id: string): boolean {
    return this.#matches(id);
  }
}

export class EntryRule {
  readonly type = "entry" as const;
  readonly glob: string;
  readonly #matches: Matcher;

  constructor(fields: { readonly glob: string }) {
    if (fields.glob === "") {
      throw new InvalidEntity(
        "PolicyRule",
        "an entry rule has an empty glob",
        fields.glob,
      );
    }

    this.glob = fields.glob;
    this.#matches = compileGlob(fields.glob);
  }

  marks(id: string): boolean {
    return this.#matches(id);
  }
}

export type PolicyRule = ForbidRule | IgnoreRule | EntryRule;

export type PolicyRuleFields =
  | {
      readonly type: "forbid";
      readonly pattern: string;
      readonly from: readonly string[];
      readonly to: readonly string[];
    }
  | { readonly type: "ignore"; readonly glob: string }
  | { readonly type: "entry"; readonly glob: string };

export const PolicyRule = {
  forbids(rules: readonly PolicyRule[] | null): ForbidRule[] {
    return (rules ?? []).filter((rule) => rule instanceof ForbidRule);
  },

  ignores(rules: readonly PolicyRule[] | null): IgnoreRule[] {
    return (rules ?? []).filter((rule) => rule instanceof IgnoreRule);
  },

  entries(rules: readonly PolicyRule[] | null): EntryRule[] {
    return (rules ?? []).filter((rule) => rule instanceof EntryRule);
  },

  of(fields: PolicyRuleFields): PolicyRule {
    if (fields.type === "forbid") {
      return new ForbidRule(fields);
    }

    return fields.type === "ignore"
      ? new IgnoreRule(fields)
      : new EntryRule(fields);
  },
};

export type ViolatedRule =
  | { readonly type: "forbid"; readonly pattern: string }
  | {
      readonly type: "level";
      readonly fromLevel: string;
      readonly toLevel: string;
    }
  | {
      readonly type: "uses";
      readonly fromComponent: string;
      readonly toComponent: string;
    };
