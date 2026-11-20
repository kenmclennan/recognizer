import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ApplyEvent, SetupChoices, TryEvent } from "recognizer";
import type {
  ApplyResultEvent,
  RecommendRead,
  SetupPort,
  SetupSurveyRead,
  TryResultEvent,
} from "./setup-port";

type SetupRun =
  | { status: "finished"; result: unknown }
  | { status: "failed"; reason: string }
  | { status: "refused"; reason: string };

async function stream<E extends { event: string }, R extends E>(
  command: string,
  choices: SetupChoices,
  onEvent: (event: E) => void,
): Promise<R> {
  const unlisten = await listen<string>("setup-run-event", (message) => {
    try {
      onEvent(JSON.parse(message.payload) as E);
    } catch {
      return;
    }
  });

  try {
    const run = await invoke<SetupRun>(command, { choices });

    if (run.status === "finished") {
      return run.result as R;
    }

    throw new Error(run.reason);
  } finally {
    unlisten();
  }
}

export const setupSource: SetupPort = {
  async survey(extract, onLine) {
    const unlisten = await listen<string>("setup-survey-event", (message) =>
      onLine(message.payload),
    );

    try {
      return await invoke<SetupSurveyRead>("setup_survey", { extract });
    } finally {
      unlisten();
    }
  },
  async recommend(prompt, schema, onLine) {
    const unlisten = await listen<string>("setup-run-line", (message) =>
      onLine(message.payload),
    );

    try {
      return await invoke<RecommendRead>("setup_recommend", { prompt, schema });
    } finally {
      unlisten();
    }
  },
  apply: (choices, onEvent) =>
    stream<ApplyEvent, ApplyResultEvent>("setup_apply", choices, onEvent),
  tryRunners: (choices, onEvent) =>
    stream<TryEvent, TryResultEvent>("setup_try", choices, onEvent),
  stop: () => invoke<void>("stop_setup"),
};
