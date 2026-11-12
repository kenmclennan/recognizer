import { ageText } from "./footer-scan";
import type { IconName } from "./icons";
import type { SuiteRef } from "./suite-ticks";

export type SuiteResult = {
  name: string;
  status: "ok" | "failed" | "partial" | "never";
  ran_at: string | null;
  reason?: string;
  measured?: number;
  total?: number;
};

export type SuiteTone = "ok" | "bad" | "muted" | "run";

export type SuiteState = {
  kind: "ok" | "failed" | "partial" | "never" | "running";
  icon: IconName;
  tone: SuiteTone;
  text: string;
  title: string;
};

export type SuiteRunning = {
  suite: string;
  done: number | null;
  total: number | null;
};

export type FoldSummary = { icon: IconName; tone: SuiteTone; text: string };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TAGS: Record<string, string> = {
  python: "py",
  typescript: "ts",
  kotlin: "kt",
  rust: "rs",
  csharp: "cs",
};

export function languageTag(language: string): string {
  return TAGS[language] ?? language;
}

export function shortAge(ms: number): string {
  const elapsed = Math.max(0, ms);

  if (elapsed < MINUTE) {
    return "now";
  }

  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m`;
  }

  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h`;
  }

  return `${Math.floor(elapsed / DAY)}d`;
}

function ranAt(result: SuiteResult): number | null {
  const at = result.ran_at === null ? Number.NaN : Date.parse(result.ran_at);

  return Number.isNaN(at) ? null : at;
}

function shortOf(result: SuiteResult, now: number): string {
  const at = ranAt(result);

  return at === null ? "" : shortAge(now - at);
}

function fullOf(result: SuiteResult, now: number): string {
  const at = ranAt(result);

  return at === null ? "" : ageText(at, now);
}

export function suiteState(
  result: SuiteResult | undefined,
  now: number,
  running: SuiteRunning | null = null,
): SuiteState {
  if (running !== null) {
    const counted = running.done !== null && running.total !== null;

    return {
      kind: "running",
      icon: "loader",
      tone: "run",
      text: counted ? `${running.done}/${running.total}` : "running",
      title: counted
        ? `${running.done} of ${running.total} functions`
        : "running",
    };
  }

  if (result === undefined || result.status === "never") {
    return {
      kind: "never",
      icon: "circle-dashed",
      tone: "muted",
      text: "never",
      title: "never run",
    };
  }

  const age = fullOf(result, now);

  switch (result.status) {
    case "ok":
      return {
        kind: "ok",
        icon: "circle-check",
        tone: "ok",
        text: shortOf(result, now),
        title: `current, ${age}`,
      };
    case "failed":
      return {
        kind: "failed",
        icon: "circle-x",
        tone: "bad",
        text: shortOf(result, now),
        title:
          result.reason === undefined
            ? `failed ${age}`
            : `failed ${age}: ${result.reason}`,
      };
    case "partial":
      return {
        kind: "partial",
        icon: "circle-pause",
        tone: "muted",
        text: `${result.measured ?? 0}/${result.total ?? 0}`,
        title: `${result.measured ?? 0} of ${result.total ?? 0} functions, ${age}`,
      };
  }
}

function prefixed(text: string, ticked: number, all: number): string {
  return ticked < all ? `${ticked}/${all} · ${text}` : text;
}

export function foldSummary(input: {
  all: number;
  results: (SuiteResult | undefined)[];
  running: SuiteRunning | null;
  now: number;
}): FoldSummary {
  const { results, all, now } = input;

  if (results.length === 0) {
    return { icon: "circle-dashed", tone: "muted", text: "none" };
  }

  if (input.running !== null) {
    const { suite, done, total } = input.running;

    return {
      icon: "loader",
      tone: "run",
      text:
        done !== null && total !== null ? `${suite} ${done}/${total}` : suite,
    };
  }

  const states = results.map((result) => suiteState(result, now));
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
      result === undefined ? now : (ranAt(result) ?? now),
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
  results: SuiteResult[] | undefined;
  running: SuiteRunning | null;
  locked: boolean;
  now: number;
}): SuiteRowModel[] {
  return input.suites.map(({ name, language }) => ({
    sensor: input.sensor,
    name,
    tag: languageTag(language),
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
  results: SuiteResult[] | undefined,
): (SuiteResult | undefined)[] {
  return suites
    .filter(({ name }) => ticked.includes(name))
    .map(({ name }) => results?.find((result) => result.name === name));
}
