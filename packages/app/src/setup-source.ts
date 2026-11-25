import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ApplyEvent, SetupChoices, TryEvent } from "recognizer";
import { coreReply } from "./scan-source";
import type {
  ApplyResultEvent,
  RecommendRead,
  SetupPort,
  SetupSurveyRead,
  TryResultEvent,
} from "./setup-port";
import type { SetupLine } from "./setup-progress";

type SetupRun =
  | { status: "finished"; result: unknown }
  | { status: "failed"; reason: string }
  | { status: "refused"; reason: string };

type SetupItem = {
  setup?: string;
  line?: string;
  event?: unknown;
};

async function start<T>(
  action: string,
  args: Record<string, unknown>,
  onItem: (item: SetupItem) => void,
): Promise<T> {
  const unlisten = await listen<SetupItem>("core-event", (message) => {
    if (message.payload.setup === action) {
      onItem(message.payload);
    }
  });

  try {
    return coreReply<T>(
      await invoke("core_call", {
        op: "setup.start",
        args: { action, ...args },
      }),
    );
  } finally {
    unlisten();
  }
}

async function stream<E extends { event: string }, R extends E>(
  action: "apply" | "try",
  choices: SetupChoices,
  onEvent: (event: E) => void,
): Promise<R> {
  const run = await start<SetupRun>(action, { choices }, (item) => {
    if (item.event !== undefined) {
      onEvent(item.event as E);
    }
  });

  if (run.status === "finished") {
    return run.result as R;
  }

  throw new Error(run.reason);
}

function lines(onLine: (line: string) => void) {
  return (item: SetupItem) => {
    if (item.line !== undefined) {
      onLine(item.line);
    }
  };
}

function setupLines(onLine: (line: SetupLine) => void) {
  return lines((text) => {
    try {
      onLine(JSON.parse(text) as SetupLine);
    } catch {
      return;
    }
  });
}

export const setupSource: SetupPort = {
  survey: (extract, onLine) =>
    start<SetupSurveyRead>("survey", { extract }, setupLines(onLine)),
  recommend: (prompt, schema, onLine) =>
    start<RecommendRead>("recommend", { prompt, schema }, lines(onLine)),
  apply: (choices, onEvent) =>
    stream<ApplyEvent, ApplyResultEvent>("apply", choices, onEvent),
  tryRunners: (choices, onEvent) =>
    stream<TryEvent, TryResultEvent>("try", choices, onEvent),
  async stop() {
    await invoke("core_call", { op: "setup.stop", args: {} });
  },
};
