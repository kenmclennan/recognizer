import type { ViolatedRule } from "../policy-rule.js";

export interface ViolationDependency {
  readonly to: string;
  readonly kind: string;
  readonly lines: readonly number[];
}

export interface Violation {
  readonly file: string;
  readonly rule: ViolatedRule;
  readonly dependencies: readonly ViolationDependency[];
}
