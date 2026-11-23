import {
  type CheckPorts,
  type CheckRequest,
  type PolicyRule,
  Repository,
  PolicyRule as Rule,
  type Say,
} from "../../src/index.js";
import { createFakes, type Fakes } from "../fakes/container.js";
import { edge, repositoryWith } from "../fakes/dependency-of.js";

export const ROOT = "/r";
export const POLICY = "/r/.recognizer/policy.yaml";
export const BASELINE = "/r/.recognizer/baselines/violations.json";

export const FORBID: PolicyRule = Rule.of({
  type: "forbid",
  pattern: "a/** -> b/**",
  from: ["a/**"],
  to: ["b/**"],
});

export function breaching(commit: string | null = null): Repository {
  const base = repositoryWith(
    ["a/x.py", "b/y.py"],
    [edge("a/x.py", "b/y.py", 3)],
  );

  return Repository.of({
    ...base,
    extractions: base.extractions.map((extraction) => ({
      ...extraction,
      commit,
      modified: commit === null ? null : false,
    })),
  });
}

export function checkPortsOf(fakes: Fakes): CheckPorts {
  return {
    analysis: fakes.analysis,
    config: fakes.config,
    findings: fakes.findings,
    policy: fakes.policy,
    baselines: fakes.baseline,
    source: fakes.source,
    digest: fakes.digest,
    testReports: fakes.testReports,
  };
}

export function requestOf(overrides: Partial<CheckRequest> = {}): CheckRequest {
  return {
    root: ROOT,
    policyFile: POLICY,
    baselinePath: BASELINE,
    flags: { baseline: undefined, update: false, init: false },
    named: [],
    ...overrides,
  };
}

export function worldOf(): { fakes: Fakes; say: Say; said: string[] } {
  const fakes = createFakes();
  const said: string[] = [];

  fakes.policy.held = [FORBID];
  fakes.config.settings = "off";

  return {
    fakes,
    said,
    say: (_stream, text) => {
      said.push(text);
    },
  };
}
