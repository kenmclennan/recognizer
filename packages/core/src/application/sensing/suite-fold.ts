import type { SuiteRef } from "../../domain/scan-plan.js";
import {
  ageText,
  type SuiteRunning,
  type SuiteStanding,
  type SuiteState,
  suiteState,
} from "./suite-state.js";

export type FoldSummary = { kind: SuiteState["kind"]; text: string };

export type SuiteRowFacts = {
  sensor: string;
  name: string;
  tag: string;
  ticked: boolean;
  disabled: boolean;
  state: SuiteState;
};

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
    return { kind: "never", text: "none" };
  }

  if (input.running !== null) {
    const { suite, done, total, stage } = input.running;

    return {
      kind: "running",
      text:
        done !== null && total !== null
          ? `${suite} ${done}/${total}`
          : (stage ?? (suite === "" ? "running" : suite)),
    };
  }

  const states = results.map((result) => suiteState(result, now));
  const failed = states.filter(({ kind }) => kind === "failed").length;

  if (failed > 0) {
    return {
      kind: "failed",
      text: prefixed(`${failed} failed`, results.length, all),
    };
  }

  if (states.some(({ kind }) => kind === "never")) {
    return { kind: "never", text: prefixed("never", results.length, all) };
  }

  if (states.some(({ kind }) => kind === "partial")) {
    return { kind: "partial", text: prefixed("partial", results.length, all) };
  }

  const oldest = Math.min(
    ...results.map((result) =>
      result === undefined ? now : (result.at ?? now),
    ),
  );

  return {
    kind: "ok",
    text: prefixed(ageText(oldest, now, "short"), results.length, all),
  };
}

export function suiteRows(input: {
  sensor: string;
  suites: SuiteRef[];
  ticked: string[];
  results: readonly SuiteStanding[] | undefined;
  running: SuiteRunning | null;
  locked: boolean;
  now: number;
}): SuiteRowFacts[] {
  return input.suites.map(({ name, language }) => ({
    sensor: input.sensor,
    name,
    tag: language,
    ticked: input.ticked.includes(name),
    disabled: input.locked,
    state: suiteState(
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
