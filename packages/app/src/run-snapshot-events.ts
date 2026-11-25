import type { Diagnosis, PluginRunView, RunView } from "@recognizer/core";
import { began } from "./scan-progress";

export type RunChange =
  | { kind: "describe-started"; total: number }
  | { kind: "described" }
  | {
      kind: "describe-ended";
      outcome: "ok" | "failed" | "stopped";
      reason: string;
    }
  | { kind: "sense-started"; name: string }
  | {
      kind: "sense-ended";
      name: string;
      outcome: "ok" | "failed" | "stopped";
      reason: string;
      diagnosis: Diagnosis | null;
    }
  | {
      kind: "extract-ended";
      name: string;
      outcome: "ok" | "failed" | "stopped";
      reason: string;
    };

function ended(plugin: PluginRunView): boolean {
  return (
    plugin.state === "finished" ||
    plugin.state === "failed" ||
    plugin.state === "stopped"
  );
}

function outcomeOf(plugin: PluginRunView): "ok" | "failed" | "stopped" {
  return plugin.state === "finished"
    ? "ok"
    : plugin.state === "stopped"
      ? "stopped"
      : "failed";
}

function describeChanges(
  before: PluginRunView | undefined,
  after: PluginRunView,
  run: RunView,
): RunChange[] {
  const changes: RunChange[] = [];
  const wasStarted = before !== undefined && began(before);

  if (began(after) && !wasStarted) {
    changes.push({
      kind: "describe-started",
      total: after.progress?.total ?? 0,
    });
  }

  const added =
    (after.progress?.done ?? 0) -
    (wasStarted ? (before.progress?.done ?? 0) : 0);

  for (let at = 0; at < added; at += 1) {
    changes.push({ kind: "described" });
  }

  if (ended(after) && !(before !== undefined && ended(before))) {
    const halted = after.state === "stopped" && run.describeHalt !== null;
    const everyFileFailed =
      after.tally !== null &&
      after.progress !== null &&
      after.progress.done > 0 &&
      after.tally.failed === after.progress.done;

    changes.push({
      kind: "describe-ended",
      outcome: halted ? (everyFileFailed ? "failed" : "ok") : outcomeOf(after),
      reason:
        after.failure?.reason ?? after.tally?.firstFailure?.reason ?? "failed",
    });
  }

  return changes;
}

export function runChangesBetween(
  before: RunView | null,
  after: RunView | null,
): RunChange[] {
  if (after === null) {
    return [];
  }

  const previous = new Map<string, PluginRunView>(
    before !== null && before.id === after.id
      ? before.plugins.map((plugin) => [
          `${plugin.phase}:${plugin.name}`,
          plugin,
        ])
      : [],
  );
  const changes: RunChange[] = [];

  for (const plugin of after.plugins) {
    const was = previous.get(`${plugin.phase}:${plugin.name}`);
    const wasStarted = was !== undefined && began(was);
    const wasEnded = was !== undefined && ended(was);

    if (plugin.phase === "describe") {
      changes.push(...describeChanges(was, plugin, after));

      continue;
    }

    if (plugin.phase === "sense") {
      if (began(plugin) && !wasStarted) {
        changes.push({ kind: "sense-started", name: plugin.name });
      }

      if (ended(plugin) && !wasEnded) {
        changes.push({
          kind: "sense-ended",
          name: plugin.name,
          outcome: outcomeOf(plugin),
          reason: plugin.failure?.reason ?? "failed",
          diagnosis: plugin.failure?.diagnosis ?? null,
        });
      }

      continue;
    }

    if (ended(plugin) && !wasEnded) {
      changes.push({
        kind: "extract-ended",
        name: plugin.name,
        outcome: outcomeOf(plugin),
        reason: plugin.failure?.reason ?? "failed",
      });
    }
  }

  return changes;
}
