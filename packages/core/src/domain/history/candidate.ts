import type { Finding } from "../finding.js";
import type { Violation } from "../violation.js";
import type { BaselineEntry } from "./baseline-repository.js";

export interface GrownViolation {
  violation: Violation;
  grown: boolean;
}

export type ReportedViolation =
  | { type: "violation"; value: GrownViolation }
  | { type: "other"; value: Finding };

export interface Candidate {
  entries: BaselineEntry[];
  keys: string[];
  value: ReportedViolation;
}

export interface Ranked {
  violations: ReportedViolation[];
  new: ReportedViolation[];
  fixed: BaselineEntry[];
}

export type BaselineAction = "none" | "initialised" | "shrunk";

export interface BaselineReport {
  path: string;
  present: boolean;
  action: BaselineAction;
}
