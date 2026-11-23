import type { PolicyRule } from "./policy-rule.js";

export interface PolicyRepository {
  rules(root: string): readonly PolicyRule[] | null;
}
