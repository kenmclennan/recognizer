import type { PlannedChange } from "./setup-changes.js";
import type { Survey } from "./setup-survey.js";

export function rehearsalChanges(
  survey: Survey,
  changes: PlannedChange[],
): PlannedChange[] {
  const testing = new Set(
    survey.checks.filter((check) => check.runs_tests).map((check) => check.id),
  );
  const rank = (change: PlannedChange) =>
    survey.runners.findIndex((runner) => `tests-${runner.name}` === change.id);

  const kept = changes.filter(
    (change) =>
      change.id.startsWith("tool-") ||
      change.id.startsWith("tests-") ||
      (change.id.startsWith("plugin-") &&
        testing.has(change.id.slice("plugin-".length))),
  );
  const others = kept.filter((change) => !change.id.startsWith("tests-"));
  const runners = kept
    .filter((change) => change.id.startsWith("tests-"))
    .sort((a, b) => rank(a) - rank(b));
  const firstRunner = kept.findIndex((change) =>
    change.id.startsWith("tests-"),
  );

  if (firstRunner === -1) {
    return kept;
  }

  const before = others.filter((change) => kept.indexOf(change) < firstRunner);
  const after = others.filter((change) => kept.indexOf(change) > firstRunner);

  return [...before, ...runners, ...after];
}
