import type { PluginRunView, RunState, RunView } from "@recognizer/core";
import type { RunSnapshotPort } from "./rescanner";
import type { RunEvent } from "./scan-port";
import { parseScanLine } from "./scan-progress";

export type FakeRunSnapshot = RunSnapshotPort & {
  publish: (run: RunView | null) => void;
  latest: () => RunView | null;
};

const ENDED_STATE: Record<string, RunState> = {
  finished: "finished",
  failed: "failed",
  refused: "refused",
  stopped: "stopped",
};

export function fakeRunSnapshot(
  feed?: (handler: (event: RunEvent) => void) => () => void,
): FakeRunSnapshot {
  let held: RunView | null = null;
  const handlers = new Set<(run: RunView | null) => void>();

  const publish = (run: RunView | null) => {
    held = run;

    for (const handler of handlers) {
      handler(run);
    }
  };

  const queuedPlugin = (name: string): PluginRunView => ({
    name,
    state: "queued",
    progress: null,
    stage: null,
    estimateMs: null,
  });

  const withPlugin = (
    name: string,
    change: (plugin: PluginRunView) => PluginRunView,
  ) => {
    if (held === null) {
      return;
    }

    const known = held.plugins.some((plugin) => plugin.name === name);
    const plugins = known
      ? held.plugins
      : [...held.plugins, queuedPlugin(name)];

    publish({
      ...held,
      plugins: plugins.map((plugin) =>
        plugin.name === name ? change(plugin) : plugin,
      ),
    });
  };

  feed?.((event) => {
    if (event.kind === "run") {
      const record = event.run;

      if (record === null) {
        publish(null);

        return;
      }

      const same = held !== null && held.id === record.run_id;
      const active = record.phase === "checking" || record.phase === "running";

      publish({
        id: record.run_id,
        startedBy: record.started_by,
        startedAt: record.started_at,
        scope: { kind: "working-tree" },
        sensors: record.sensors,
        describe: record.describe,
        suites: {},
        state: active
          ? (record.phase as RunState)
          : (ENDED_STATE[record.phase] ?? "stopped"),
        endedAt: record.ended_at,
        exit: record.exit,
        plugins: same
          ? (held?.plugins ?? [])
          : record.sensors.map(queuedPlugin),
      });

      return;
    }

    const parsed = parseScanLine(event.line);

    if (parsed === null) {
      return;
    }

    if (parsed.event === "start") {
      withPlugin(parsed.name, (plugin) => ({ ...plugin, state: "running" }));
    } else if (parsed.event === "entry" && parsed.phase === "sense") {
      withPlugin(parsed.name, (plugin) => ({
        ...plugin,
        state:
          parsed.outcome === "ok"
            ? "finished"
            : parsed.outcome === "stopped"
              ? "stopped"
              : "failed",
      }));
    } else if (
      parsed.event === "plugin" &&
      parsed.phase === "sense" &&
      parsed.data.event === "progress"
    ) {
      const { done, total, unit } = parsed.data;

      withPlugin(parsed.name, (plugin) => ({
        ...plugin,
        state: "running",
        progress: { done, total, unit },
      }));
    }
  });

  return {
    run: () => held,
    onRun(handler) {
      handlers.add(handler);

      return () => handlers.delete(handler);
    },
    publish,
    latest: () => held,
  };
}
