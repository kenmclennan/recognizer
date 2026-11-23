import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  type Repository,
  senseStructure,
} from "../../src/index.js";
import { breaching, FORBID } from "./analysis-world.js";

function spied(repository: Repository) {
  const calls = { violations: 0, cycleWarnings: 0 };
  const violations = repository.violations.bind(repository);
  const cycleWarnings = repository.cycleWarnings.bind(repository);

  repository.violations = (rules) => {
    calls.violations += 1;

    return violations(rules);
  };
  repository.cycleWarnings = (rules) => {
    calls.cycleWarnings += 1;

    return cycleWarnings(rules);
  };

  return calls;
}

const CONTEXT = { commit: "", modified: false };

describe("senseStructure", () => {
  it("calls the entity methods", () => {
    const repository = breaching();
    const calls = spied(repository);

    senseStructure(repository, [FORBID], DEFAULT_STRUCTURE_SETTINGS, CONTEXT);

    expect(calls).toEqual({ violations: 1, cycleWarnings: 1 });
  });

  it("asks for no cycle warnings when the setting is off", () => {
    const repository = breaching();
    const calls = spied(repository);

    senseStructure(
      repository,
      [FORBID],
      {
        ...DEFAULT_STRUCTURE_SETTINGS,
        warnings: { ...DEFAULT_STRUCTURE_SETTINGS.warnings, cycle: false },
      },
      CONTEXT,
    );

    expect(calls).toEqual({ violations: 1, cycleWarnings: 0 });
  });
});
