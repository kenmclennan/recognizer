import type { PolicyRule } from "../../domain/policy-rule.js";
import { compileGlob, type Matcher } from "./glob.js";

export interface CompiledForbid {
  readonly pattern: string;
  readonly fromGlobs: readonly string[];
  readonly toGlobs: readonly string[];
  readonly from: Matcher;
  readonly to: Matcher;
}

export interface CompiledPolicy {
  readonly forbid: readonly CompiledForbid[];
  readonly ignore: readonly Matcher[];
  readonly entry: readonly Matcher[];
  readonly entryGlobs: readonly string[];
}

export function compilePolicy(
  rules: readonly PolicyRule[] | null,
): CompiledPolicy {
  const forbid: CompiledForbid[] = [];
  const ignore: Matcher[] = [];
  const entry: Matcher[] = [];
  const entryGlobs: string[] = [];

  for (const rule of rules ?? []) {
    if (rule.type === "forbid") {
      const from = rule.from.map(compileGlob);
      const to = rule.to.map(compileGlob);

      forbid.push({
        pattern: rule.pattern,
        fromGlobs: rule.from,
        toGlobs: rule.to,
        from: (id) => from.some((one) => one(id)),
        to: (id) => to.some((one) => one(id)),
      });
    } else if (rule.type === "ignore") {
      ignore.push(compileGlob(rule.glob));
    } else {
      entry.push(compileGlob(rule.glob));
      entryGlobs.push(rule.glob);
    }
  }

  return { forbid, ignore, entry, entryGlobs };
}
