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
  behind: ReadonlyMap<string, number>;
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
      input.behind.get(name) ?? 0,
    ),
  }));
}

function trimmed(directory: string): string {
  return directory === "." ? "" : directory.replace(/\/+$/, "");
}

function covers(directory: string, file: string): boolean {
  const root = trimmed(directory);

  return root === "" || file === root || file.startsWith(`${root}/`);
}

export function suitesBehind(input: {
  suites: readonly { name: string; directory: string }[];
  files: readonly string[];
  current: ReadonlySet<string> | readonly string[];
}): Map<string, number> {
  const fresh = new Set(input.current);
  const behind = new Map(input.suites.map(({ name }) => [name, 0]));

  for (const file of input.files) {
    if (fresh.has(file)) {
      continue;
    }

    let owner: { name: string; length: number } | null = null;

    for (const { name, directory } of input.suites) {
      const length = trimmed(directory).length;

      if (
        covers(directory, file) &&
        (owner === null || length > owner.length)
      ) {
        owner = { name, length };
      }
    }

    if (owner !== null) {
      behind.set(owner.name, (behind.get(owner.name) ?? 0) + 1);
    }
  }

  return behind;
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
