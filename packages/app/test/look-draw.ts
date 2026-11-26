import { composeApp } from "../src/app-root";
import { domViewOver } from "../src/dom-view";
import { buildFooter } from "../src/footer-view";
import { answerFor, type Recording } from "./look-recording";

type Internals = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback: (callback: (event: unknown) => void) => number;
  unregisterCallback: () => void;
  metadata: unknown;
};

export function installRecording(given: Recording): void {
  const recording = { ...given, events: [...given.events] };
  const target = window as unknown as { __TAURI_INTERNALS__: Internals };
  const callbacks = new Map<number, (event: unknown) => void>();
  const listening = new Map<string, number[]>();
  let nextCallback = 1;
  let dripping = false;

  const drip = () => {
    const payload = recording.events.shift();

    if (payload === undefined) {
      return;
    }

    for (const id of listening.get("core-event") ?? []) {
      callbacks.get(id)?.({ event: "core-event", id, payload });
    }

    setTimeout(drip, 25);
  };

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

      const reply = answerFor(recording, command, args);

      if (!dripping && command === "core_call") {
        dripping = true;
        setTimeout(drip, 50);
      }

      return reply;
    },
    transformCallback: (callback) => {
      const id = nextCallback;

      nextCallback += 1;
      callbacks.set(id, callback);

      return id;
    },
    unregisterCallback: () => {},
    metadata: {
      currentWindow: { label: "w-1" },
      currentWebview: { label: "w-1", windowLabel: "w-1" },
    },
  };
}

export async function drawRecording(
  container: HTMLElement,
  recording: Recording,
): Promise<void> {
  installRecording(recording);

  const footerElement =
    document.getElementById("footer") ?? document.createElement("footer");
  const app = composeApp(domViewOver(container, buildFooter(footerElement)));

  void app.started;

  for (let waited = 0; waited < 20000; waited += 50) {
    if (container.querySelector(".rail-scan") !== null) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `the recording never drew an explorer: ${container.innerHTML.slice(0, 300)}`,
  );
}
