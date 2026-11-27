import {
  type SuiteState as CoreSuiteState,
  suiteState as coreSuiteState,
  type SuiteRunning,
  type SuiteStanding,
  shortAge,
} from "@recognizer/core";
import type { IconName } from "./icons";
import type { SuiteRef } from "./scan-panel-model";

export type SuiteTone = "ok" | "bad" | "muted" | "run";

export type SuiteState = CoreSuiteState & { icon: IconName; tone: SuiteTone };

export const LOOK: Record<
  CoreSuiteState["kind"],
  { icon: IconName; tone: SuiteTone }
> = {
  ok: { icon: "circle-check", tone: "ok" },
  failed: { icon: "circle-x", tone: "bad" },
  partial: { icon: "circle-pause", tone: "muted" },
  never: { icon: "circle-dashed", tone: "muted" },
  running: { icon: "loader", tone: "run" },
};

function viewState(
  standing: SuiteStanding | undefined,
  now: number,
  running: SuiteRunning | null = null,
): SuiteState {
  const state = coreSuiteState(standing, now, running);

  return { ...state, ...LOOK[state.kind] };
}

export type FoldSummary = { icon: IconName; tone: SuiteTone; text: string };

function prefixed(text: string, ticked: number, all: number): string {
  return ticked < all ? `${ticked}/${all} · ${text}` : text;
}

export function foldSummary(input: {
  all: number;
  results: (SuiteStanding | undefined)[];
  running: SuiteRunning | null;
  now: number;
}): FoldSummary {
  const { results, all, now } = input;

  if (results.length === 0) {
    return { icon: "circle-dashed", tone: "muted", text: "none" };
  }

  if (input.running !== null) {
    const { suite, done, total, stage } = input.running;

    return {
      icon: "loader",
      tone: "run",
      text:
        done !== null && total !== null
          ? `${suite} ${done}/${total}`
          : (stage ?? (suite === "" ? "running" : suite)),
    };
  }

  const states = results.map((result) => coreSuiteState(result, now));
  const failed = states.filter(({ kind }) => kind === "failed").length;

  if (failed > 0) {
    return {
      icon: "circle-x",
      tone: "bad",
      text: prefixed(`${failed} failed`, results.length, all),
    };
  }

  if (states.some(({ kind }) => kind === "never")) {
    return {
      icon: "circle-dashed",
      tone: "muted",
      text: prefixed("never", results.length, all),
    };
  }

  if (states.some(({ kind }) => kind === "partial")) {
    return {
      icon: "circle-pause",
      tone: "muted",
      text: prefixed("partial", results.length, all),
    };
  }

  const oldest = Math.min(
    ...results.map((result) =>
      result === undefined ? now : (result.at ?? now),
    ),
  );

  return {
    icon: "circle-check",
    tone: "ok",
    text: prefixed(shortAge(now - oldest), results.length, all),
  };
}

export type SuiteRowModel = {
  sensor: string;
  name: string;
  tag: string;
  ticked: boolean;
  disabled: boolean;
  state: SuiteState;
};

export function suiteRows(input: {
  sensor: string;
  suites: SuiteRef[];
  ticked: string[];
  results: readonly SuiteStanding[] | undefined;
  running: SuiteRunning | null;
  locked: boolean;
  now: number;
}): SuiteRowModel[] {
  return input.suites.map(({ name, language }) => ({
    sensor: input.sensor,
    name,
    tag: language,
    ticked: input.ticked.includes(name),
    disabled: input.locked,
    state: viewState(
      input.results?.find((result) => result.name === name),
      input.now,
      input.running?.suite === name ? input.running : null,
    ),
  }));
}

export function tickedResults(
  suites: SuiteRef[],
  ticked: string[],
  results: readonly SuiteStanding[] | undefined,
): (SuiteStanding | undefined)[] {
  return suites
    .filter(({ name }) => ticked.includes(name))
    .map(({ name }) => results?.find((result) => result.name === name));
}
