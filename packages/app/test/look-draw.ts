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

export type Sent = { command: string; args: Record<string, unknown> };

export type Hold = (
  command: string,
  args: Record<string, unknown>,
  call: number,
) => Promise<unknown> | undefined;

export type Answer = (
  command: string,
  args: Record<string, unknown>,
) => unknown;

export type Served = {
  drained: () => Promise<void>;
  release: (mark: string) => void;
  deliverHostEvents: () => void;
  stop: () => void;
  sent: () => Sent[];
};

export type Drawn = {
  explorer: () => Explorer | null;
  release: (mark: string) => void;
  dispose: () => void;
  deliverHostEvents: () => void;
  sent: () => Sent[];
  drained: () => Promise<void>;
};

export type DrawOptions = {
  until?: string;
  carried?: Carried | null;
  hostEvents?: "later";
  hold?: Hold;
  answer?: Answer;
};

export function installRecording(
  given: Recording,
  options: { until?: string; hold?: Hold; answer?: Answer } = {},
): Served {
  const recording = { ...given, events: [...given.events] };
  const marks = given.marks ?? {};
  const batchEnds = new Set(given.batches ?? []);
  let served = 0;
  let joining = false;
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
  const abandoned = new Set<string>();
  let stopped = false;
  let dripping = false;
  let started = false;
  let waits = 0;
  const sent: Sent[] = [];
  const calls = new Map<string, number>();

  const drip = () => {
    dripping = false;

    if (stopped || served >= limit) {
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

    if (
      stream !== undefined &&
      !abandoned.has(stream) &&
      !claimed.has(stream)
    ) {
      waits += 1;

      if (waits >= 8) {
        abandoned.add(stream);
        waits = 0;
      }

      dripping = true;
      setTimeout(drip, 25);

      return;
    }

    waits = 0;
    served += 1;

    for (const id of listeners) {
      callbacks.get(id)?.({ event: "core-event", id, payload });
    }

    const failed =
      (payload as { outcome?: { status?: string } }).outcome?.status ===
      "failed";

    if (failed) {
      joining = true;
    }

    if (joining && served < limit && !batchEnds.has(served)) {
      drip();

      return;
    }

    joining = false;

    dripping = true;

    if (stream !== undefined && abandoned.has(stream)) {
      drip();

      return;
    }

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

      if (!command.startsWith("plugin:")) {
        sent.push({ command, args: args ?? {} });
      }

      const key = `${command} ${JSON.stringify(args ?? {})}`;
      const call = (calls.get(key) ?? 0) + 1;

      calls.set(key, call);

      const held = options.hold?.(command, args ?? {}, call);
      const declared = options.answer?.(command, args ?? {});
      const reply =
        declared !== undefined
          ? declared
          : answerFor(
              recording,
              command,
              args,
              options.until === undefined ? undefined : limit,
              call,
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

      if (held !== undefined) {
        await held;
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
      while (!stopped && served < limit) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    },
    release: (mark) => {
      limit = marks[mark] ?? limit;

      if (!stopped && started && !dripping) {
        dripping = true;
        setTimeout(drip, 25);
      }
    },
    deliverHostEvents: () => {
      if (stopped) {
        return;
      }

      for (const { event, payload } of recording.hostEvents ?? []) {
        for (const id of listening.get(event) ?? []) {
          callbacks.get(id)?.({ event, id, payload });
        }
      }
    },
    stop: () => {
      stopped = true;
    },
    sent: () => [...sent],
  };
}

let live: Drawn | null = null;

export async function drawRecording(
  container: HTMLElement,
  recording: Recording,
  options: DrawOptions = {},
): Promise<Drawn> {
  live?.dispose();
  live = null;

  const served = installRecording(recording, {
    ...(options.until === undefined ? {} : { until: options.until }),
    ...(options.hold === undefined ? {} : { hold: options.hold }),
    ...(options.answer === undefined ? {} : { answer: options.answer }),
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
      if (options.hostEvents !== "later") {
        served.deliverHostEvents();
      }

      await served.drained();

      const drawn: Drawn = {
        explorer: () => built[built.length - 1] ?? null,
        release: (mark) => served.release(mark),
        dispose: () => {
          served.stop();

          for (const explorer of built.splice(0)) {
            explorer.dispose();
          }
        },
        deliverHostEvents: () => served.deliverHostEvents(),
        sent: () => served.sent(),
        drained: () => served.drained(),
      };

      live = drawn;

      return drawn;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `the recording never drew an explorer: ${container.innerHTML.slice(0, 300)}`,
  );
}
