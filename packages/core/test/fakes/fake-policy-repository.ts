import { createHash } from "node:crypto";
import {
  InvalidRequest,
  type PolicyRepository,
  PolicyRule,
  type RepositoryText,
} from "../../src/index.js";

export class FakePolicyRepository implements PolicyRepository {
  held: readonly PolicyRule[] | null = [];
  file: string | null = null;

  rules(): readonly PolicyRule[] | null {
    return this.held;
  }

  rulesAt(): readonly PolicyRule[] {
    return this.held ?? [];
  }

  defaultFile(): string | null {
    return this.file;
  }

  heldText: string | null = null;
  saves: string[] = [];
  problemsByText = new Map<string, string[]>();

  text(): RepositoryText {
    const text = this.heldText ?? "";

    return {
      present: this.heldText !== null,
      text,
      hash: createHash("sha256").update(text, "utf8").digest("hex"),
    };
  }

  saveText(_root: string, text: string): void {
    this.heldText = text;
    this.saves.push(text);
  }

  problems(text: string): string[] {
    return this.problemsByText.get(text) ?? [];
  }

  raw: Record<string, unknown> = {};
  refused: string | null = null;

  document(): Record<string, unknown> {
    return this.raw;
  }

  parseDocument(document: Record<string, unknown>): readonly PolicyRule[] {
    if (this.refused !== null) {
      throw new InvalidRequest([this.refused]);
    }

    const list = (value: unknown): unknown[] =>
      Array.isArray(value) ? value : value === undefined ? [] : [value];
    const text = (value: unknown, where: string): string => {
      if (typeof value !== "string" || value.trim() === "") {
        throw new InvalidRequest([`${where} must be a non-empty string`]);
      }

      return value;
    };
    const rules: PolicyRule[] = [];

    for (const glob of list(document.ignore)) {
      rules.push(PolicyRule.of({ type: "ignore", glob: text(glob, "ignore") }));
    }

    for (const glob of list(document.entry)) {
      rules.push(PolicyRule.of({ type: "entry", glob: text(glob, "entry") }));
    }

    for (const entry of list(document.forbid)) {
      const { from, to } = entry as { from: unknown; to: unknown };
      const fromGlobs = list(from).map((glob) => text(glob, "forbid from"));
      const toGlobs = list(to).map((glob) => text(glob, "forbid to"));

      rules.push(
        PolicyRule.of({
          type: "forbid",
          pattern: `${fromGlobs.join(",")} -> ${toGlobs.join(",")}`,
          from: fromGlobs,
          to: toGlobs,
        }),
      );
    }

    return rules;
  }
}
