import { afterEach, vi } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import type { AppView, ExplorerRequest } from "../src/app-root";
import type { Explorer, ScanHost } from "../src/explorer";
import type { FooterView } from "../src/footer-view";
import { isStale } from "../src/freshness-facts";
import type { HoldingView } from "../src/holding-view";
import type { Loaded } from "../src/scan-loading";
import type { OpenActions, OpenView } from "../src/scan-open-view";
import { rowSensors } from "../src/scan-panel-model";

type Listener = (event: { payload: unknown }) => void;

const hoisted = vi.hoisted(() => ({
  invoke: async (_command: string, _args?: Record<string, unknown>) =>
    undefined as unknown,
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));

export const bridge = hoisted;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    hoisted.invoke(command, args),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "w-1",
    listen: async (event: string, handler: Listener) => {
      const set = hoisted.listeners.get(event) ?? new Set();

      set.add(handler);
      hoisted.listeners.set(event, set);

      return () => set.delete(handler);
    },
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: Listener) => {
    const set = hoisted.listeners.get(event) ?? new Set();

    set.add(handler);
    hoisted.listeners.set(event, set);

    return () => set.delete(handler);
  },
}));

export type Line = Record<string, unknown>;

export type RecordedExplorer = Explorer & {
  loads: Loaded[];
  reloads: number;
  host: ScanHost;
};

export type RecordingView = AppView & {
  readonly explorers: RecordedExplorer[];
  readonly counts: string[];
  readonly scanLines: (string | null)[];
  readonly messages: { text: string; isError: boolean }[];
  readonly shown: string[];
  explorer(): RecordedExplorer | null;
  loaded(): Loaded | null;
  freshnessOf(name: string): string | undefined;
  rows(): Promise<ReturnType<typeof rowSensors>>;
};

export function recordingView(): RecordingView {
  const counts: string[] = [];
  const scanLines: (string | null)[] = [];
  const messages: { text: string; isError: boolean }[] = [];
  const shown: string[] = [];
  const explorers: RecordedExplorer[] = [];

  const footer: FooterView = {
    post: () => null,
    attach: () => {},
    withdraw: () => {},
    relabel: () => {},
    reconcile: () => {},
    setCount: (text) => counts.push(text),
    setScan: (text) => scanLines.push(text),
  };

  const explorer = () => explorers[explorers.length - 1] ?? null;
  const loaded = () => {
    const last = explorer();

    return last === null ? null : (last.loads[last.loads.length - 1] ?? null);
  };

  return {
    footer,
    explorers,
    counts,
    scanLines,
    messages,
    shown,
    explorer,
    loaded,
    freshnessOf: (name) => {
      const facts = loaded()?.freshness?.[name];

      if (facts === undefined) {
        return undefined;
      }

      return isStale(facts) ? "stale" : "current";
    },
    rows: async () => {
      const host = explorer()?.host;

      if (host === undefined) {
        throw new Error("the panel was never handed a model");
      }

      return rowSensors(
        (await host.port.inputs()).config,
        await host.port.sensorList(),
      );
    },
    clear: () => {
      shown.push("clear");
    },
    showEmpty: () => {
      shown.push("empty");
    },
    showMessage: (text, isError = false) => {
      messages.push({ text, isError });
    },
    showHolding: (): HoldingView => {
      shown.push("holding");

      return { update: () => {}, remove: () => {} };
    },
    showOpen: (_actions: OpenActions): OpenView => {
      shown.push("open");

      return { render: () => {}, remove: () => {} };
    },
    showExplorer: (request: ExplorerRequest) => {
      const recorded: RecordedExplorer = {
        loads: [request.loaded],
        reloads: 0,
        host: request.scanHost,
        toggleTree: () => {},
        carry: () => null as never,
        update: (next) => {
          recorded.loads.push(next);
        },
        reloadSensors: async () => {
          recorded.reloads += 1;
        },
        openSelectedInEditor: () => {},
        openLinkedView: () => {},
        refreshResponsibilities: () => {},
        refreshPanel: () => {},
        setSetupProblems: () => {},
        show: () => {},
        dispose: () => {},
      };

      explorers.push(recorded);
      shown.push("explorer");
      request.onKeys([]);

      return recorded;
    },
    openSettings: () => ({ close: () => {} }) as never,
    openSetup: () => ({ close: () => {} }) as never,
  };
}

export const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }

  hoisted.listeners.clear();
});

export type TimedResult<T> = { value: T; elapsedMs: number; limitMs: number };

export async function timeEndToEnd<T>(
  serve: { signal(ms: number): Promise<void> },
  options: {
    limitMs: number;
    action: () => void | Promise<void>;
    until: () => T | undefined;
  },
): Promise<TimedResult<T>> {
  const limitMs = scaledTimeout(options.limitMs);
  const start = performance.now();

  await options.action();

  for (;;) {
    const value = options.until();
    const elapsedMs = performance.now() - start;

    if (value !== undefined) {
      if (elapsedMs > limitMs) {
        throw new Error(
          `held after ${Math.round(elapsedMs)} ms, over the ${limitMs} ms limit`,
        );
      }

      return { value, elapsedMs, limitMs };
    }

    if (elapsedMs > limitMs) {
      throw new Error(
        `did not hold within ${limitMs} ms (elapsed ${Math.round(elapsedMs)} ms)`,
      );
    }

    await serve.signal(50);
  }
}

export async function untilHolds<T>(
  serve: { signal(ms: number): Promise<void> },
  until: () => T | undefined,
  limitMs = 60_000,
): Promise<T> {
  return (await timeEndToEnd(serve, { limitMs, action: () => {}, until }))
    .value;
}
