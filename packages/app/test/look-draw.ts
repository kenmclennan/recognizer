import { composeApp } from "../src/app-root";
import { domViewOver } from "../src/dom-view";
import type { Carried, Explorer } from "../src/explorer";
import { buildFooter } from "../src/footer-view";
import { answerFor, type Recording } from "./look-recording";

type Internals = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback: (callback: (event: unknown) => void) => number;
  unregisterCallback: () => void;
  metadata: unknown;
};

type Bridge = {
  callbacks: Map<number, (event: unknown) => void>;
  listening: Map<string, number[]>;
  next: number;
};

export type Served = {
  drained: () => Promise<void>;
  release: (mark: string) => void;
  deliverHostEvents: () => void;
};

export type Drawn = {
  explorer: () => Explorer | null;
  release: (mark: string) => void;
  dispose: () => void;
};

export type DrawOptions = { until?: string; carried?: Carried | null };

export function installRecording(
  given: Recording,
  options: { until?: string } = {},
): Served {
  const recording = { ...given, events: [...given.events] };
  const marks = given.marks ?? {};
  let served = 0;
  let limit =
    options.until === undefined
      ? recording.events.length
      : (marks[options.until] ?? 0);
  const target = window as unknown as { __TAURI_INTERNALS__: Internals };
  const host = window as unknown as { __lookBridge?: Bridge };

  host.__lookBridge ??= { callbacks: new Map(), listening: new Map(), next: 1 };

  const shared = host.__lookBridge;
  const { callbacks, listening } = shared;
  const claimed = new Set<string>();
  let dripping = false;
  let started = false;
  let waits = 0;

  const drip = () => {
    dripping = false;

    if (served >= limit) {
      return;
    }

    const listeners = listening.get("core-event") ?? [];

    if (listeners.length === 0) {
      dripping = true;
      setTimeout(drip, 25);

      return;
    }

    const payload = recording.events[served];
    const stream = (payload as { stream?: string }).stream;

    if (stream !== undefined && !claimed.has(stream) && waits < 20) {
      waits += 1;
      dripping = true;
      setTimeout(drip, 25);

      return;
    }

    waits = 0;
    served += 1;

    for (const id of listeners) {
      callbacks.get(id)?.({ event: "core-event", id, payload });
    }

    dripping = true;
    setTimeout(drip, 25);
  };

  (
    window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }
  ).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

  target.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      if (command === "plugin:event|listen") {
        const event = String(args?.event);

        listening.set(event, [
          ...(listening.get(event) ?? []),
          Number(args?.handler),
        ]);

        return 0;
      }

      if (command.startsWith("plugin:event|")) {
        return 0;
      }

      const reply = answerFor(
        recording,
        command,
        args,
        options.until === undefined ? undefined : limit,
      );

      const claim = (reply as { ok?: unknown } | null)?.ok;

      if (command === "core_call" && typeof claim === "string") {
        claimed.add(claim);
      }

      if (!started && command === "core_call") {
        started = true;
        dripping = true;
        setTimeout(drip, 50);
      }

      return reply;
    },
    transformCallback: (callback) => {
      const id = shared.next;

      shared.next += 1;
      callbacks.set(id, callback);

      return id;
    },
    unregisterCallback: () => {},
    metadata: {
      currentWindow: { label: "w-1" },
      currentWebview: { label: "w-1", windowLabel: "w-1" },
    },
  };

  return {
    drained: async () => {
      while (served < limit) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    },
    release: (mark) => {
      limit = marks[mark] ?? limit;

      if (started && !dripping) {
        dripping = true;
        setTimeout(drip, 25);
      }
    },
    deliverHostEvents: () => {
      for (const { event, payload } of recording.hostEvents ?? []) {
        for (const id of listening.get(event) ?? []) {
          callbacks.get(id)?.({ event, id, payload });
        }
      }
    },
  };
}

export async function drawRecording(
  container: HTMLElement,
  recording: Recording,
  options: DrawOptions = {},
): Promise<Drawn> {
  const served = installRecording(recording, {
    ...(options.until === undefined ? {} : { until: options.until }),
  });

  const footerElement =
    document.getElementById("footer") ?? document.createElement("footer");
  const inner = domViewOver(container, buildFooter(footerElement));
  const built: Explorer[] = [];
  let carried = options.carried ?? null;
  const app = composeApp({
    ...inner,
    showExplorer: (request) => {
      const explorer = inner.showExplorer(
        carried === null ? request : { ...request, carried },
      );

      carried = null;
      built.push(explorer);

      return explorer;
    },
  });

  void app.started;

  for (let waited = 0; waited < 20000; waited += 50) {
    if (container.querySelector(".rail-scan") !== null) {
      served.deliverHostEvents();
      await served.drained();

      return {
        explorer: () => built[built.length - 1] ?? null,
        release: (mark) => served.release(mark),
        dispose: () => built[built.length - 1]?.dispose(),
      };
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `the recording never drew an explorer: ${container.innerHTML.slice(0, 300)}`,
  );
}
