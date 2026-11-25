import type { PluginRunView, RunView } from "@recognizer/core";
import type { ScanEvent } from "./scan-progress";

export type FailureDetail = Pick<
  Extract<ScanEvent, { event: "entry" }>,
  "reason" | "diagnosis"
>;

function ended(plugin: PluginRunView): boolean {
  return (
    plugin.state === "finished" ||
    plugin.state === "failed" ||
    plugin.state === "stopped"
  );
}

function sameProgress(
  before: PluginRunView | undefined,
  after: PluginRunView,
): boolean {
  const a = before?.progress ?? null;
  const b = after.progress;

  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.done === b.done &&
      a.total === b.total &&
      a.unit === b.unit)
  );
}

export function sensorEventsBetween(
  before: RunView | null,
  after: RunView | null,
  detail: (name: string) => FailureDetail | undefined = () => undefined,
): ScanEvent[] {
  if (after === null) {
    return [];
  }

  const previous = new Map<string, PluginRunView>(
    before !== null && before.id === after.id
      ? before.plugins.map((plugin) => [plugin.name, plugin])
      : [],
  );
  const events: ScanEvent[] = [];
  const anyStarted = [...previous.values()].some(
    (plugin) => plugin.state !== "queued",
  );

  if (
    !anyStarted &&
    after.plugins.some((plugin) => plugin.state !== "queued")
  ) {
    events.push({
      event: "phase",
      phase: "sense",
      total: after.plugins.length,
    });
  }

  for (const plugin of after.plugins) {
    const was = previous.get(plugin.name);
    const wasStarted = was !== undefined && was.state !== "queued";

    if (plugin.state !== "queued" && !wasStarted) {
      events.push({ event: "start", phase: "sense", name: plugin.name });
    }

    if (
      plugin.state === "running" &&
      plugin.progress !== null &&
      !sameProgress(was, plugin)
    ) {
      events.push({
        event: "plugin",
        phase: "sense",
        name: plugin.name,
        data: {
          event: "progress",
          done: plugin.progress.done,
          total: plugin.progress.total,
          unit: plugin.progress.unit,
        },
      });
    }

    if (ended(plugin) && !(was !== undefined && ended(was))) {
      events.push({
        event: "entry",
        phase: "sense",
        name: plugin.name,
        outcome:
          plugin.state === "finished"
            ? "ok"
            : plugin.state === "stopped"
              ? "stopped"
              : "failed",
        ...(plugin.state === "failed"
          ? { reason: "failed", ...detail(plugin.name) }
          : {}),
      });
    }
  }

  return events;
}
