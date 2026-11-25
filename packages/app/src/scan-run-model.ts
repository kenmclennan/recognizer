import type { PluginRunView, RunView as Run, RunState } from "@recognizer/core";
import { roundedTime } from "./estimate-text";
import { ageText } from "./footer-scan";
import type { IconName } from "./icons";
import { runLogPath } from "./run-log-path";
import {
  foldProgress,
  type ScanEvent,
  type ScanProgress,
} from "./scan-progress";

export type RunInput = {
  run: Run | null;
  progress: ScanProgress;
  starting: { at: number } | null;
  adoptedAtOpen: string | null;
};

export type RunView = RunInput & { display: (name: string) => string };

export type GapItem = {
  id: string;
  line: string;
  where: string;
};

export type HelpLine = {
  sensor: string;
  text: string;
  command: string;
};

export type RunCardTone = "run" | "ok" | "bad" | "warn" | "muted";

export type RunCard = {
  phase: RunState;
  icon: IconName;
  tone: RunCardTone;
  head: string;
  line: string | null;
  lineTitle: string | null;
  showLog: string | null;
  gaps: GapItem[];
  help: HelpLine[];
  when: { text: string; title?: string };
  origin: { icon: IconName | null; text: string };
};

export type RunModel = {
  card: RunCard;
  subtitle: string;
  active: boolean;
  refused: boolean;
  button: { label: string; stop: boolean };
  partial: { sensor: string; text: string } | null;
};

function timed(
  state: ScanProgress,
  next: ScanProgress,
  event: ScanEvent,
  at: number,
): ScanProgress {
  switch (event.event) {
    case "plugin":
      return extractStamped(next, event, at);
    case "entry":
      return event.phase === "extract"
        ? {
            ...next,
            timing: {
              ...next.timing,
              extractDoneAt: {
                ...state.timing.extractDoneAt,
                [event.name]: at,
              },
            },
          }
        : next;
    default:
      return next;
  }
}

function extractStamped(
  next: ScanProgress,
  event: Extract<ScanEvent, { event: "plugin" }>,
  at: number,
): ScanProgress {
  if (event.phase !== "extract") {
    return next;
  }

  const { timing } = next;
  const { name, data } = event;

  return {
    ...next,
    timing: {
      ...timing,
      extractAt:
        name in timing.extractAt
          ? timing.extractAt
          : { ...timing.extractAt, [name]: at },
      extractTotals:
        data.event === "start"
          ? { ...timing.extractTotals, [name]: data.total }
          : timing.extractTotals,
    },
  };
}

export function foldRunEvent(
  state: ScanProgress,
  event: ScanEvent,
  at: number,
): ScanProgress {
  const next = timed(state, foldProgress(state, event), event, at);

  if (event.event === "start") {
    return { ...next, sensing: event.name };
  }

  if (
    (event.event === "entry" && event.phase === "sense") ||
    event.event === "summary"
  ) {
    return { ...next, sensing: null };
  }

  return next;
}

export const CHECKING_HEAD = "Checking tools";

export const NOTHING_RAN_TEXT = "Nothing ran";

export const SET_UP_LINE = "Set it up or untick the suite.";

export const FINISHED_HEAD = "Scan finished";

export const STOPPED_HEAD = "Scan stopped";

export const FINISHED_KEPT_TEXT = "Finished results kept";

export const HELP_TEXT = "To set this up with an agent:";

export const AGAIN_TEXT = "Check again and scan";

export const IDLE_SUBTITLE = "Pick what to measure, then scan.";

export const SCANNING_HEAD = "Scanning";

export const FINISHING_TEXT = "Finishing";

export const DESCRIPTIONS_NAME = "Descriptions";

function two(value: number): string {
  return String(value).padStart(2, "0");
}

export function clockText(iso: string | null): string {
  const at = iso === null ? Number.NaN : Date.parse(iso);

  if (Number.isNaN(at)) {
    return "--:--";
  }

  const date = new Date(at);

  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function clockOfMs(ms: number): string {
  const date = new Date(ms);

  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function isActive(run: { state: RunState } | null): boolean {
  return run !== null && (run.state === "checking" || run.state === "running");
}

function sensorOf(
  gap: Run["gaps"][number],
  sensors: ReadonlySet<string>,
): string | null {
  const [only] = gap.needs;

  if (gap.needs.length !== 1 || only === undefined) {
    return null;
  }

  return sensors.has(only) && gap.id.startsWith(`${only}:`) ? only : null;
}

function origin(
  by: "cli" | "app",
  time: string,
): { icon: IconName | null; text: string } {
  return by === "cli"
    ? { icon: "terminal", text: `Started from the command line at ${time}` }
    : { icon: null, text: `Started here at ${time}` };
}

function listNames(names: string[]): string {
  return names.join(", ");
}

function currentLine(run: Run, view: RunView): string {
  const { progress, display } = view;
  const current = run.plugins.find(({ state }) => state === "running");

  if (current !== undefined) {
    const name = display(current.name);
    const parts = [
      name,
      ...(current.stage === null ? [] : [current.stage.name]),
      ...(current.progress === null
        ? []
        : [`${current.progress.done}/${current.progress.total}`]),
    ];

    return parts.join(" \u00b7 ");
  }

  const describing = progress.describe;

  if (
    run.describe &&
    describing !== null &&
    describing.entries.length < describing.total
  ) {
    return `${DESCRIPTIONS_NAME}: ${describing.entries.length} of ${describing.total} files`;
  }

  return FINISHING_TEXT;
}

function measuredLine(run: Run): string {
  const count =
    run.plugins.filter(({ state }) => state !== "failed").length +
    (run.describe ? 1 : 0);

  return `${count} ${count === 1 ? "sensor" : "sensors"} measured`;
}

type Kept = {
  sensor: string;
  stage: string | null;
  done: number;
  total: number;
};

function keptCounts(run: Run): Kept | null {
  const kept = [...run.plugins]
    .reverse()
    .find(({ state, progress }) => state === "stopped" && progress !== null);

  if (kept === undefined || kept.progress === null) {
    return null;
  }

  return {
    sensor: kept.name,
    stage: kept.stage?.name ?? null,
    done: kept.progress.done,
    total: kept.progress.total,
  };
}

function stoppedLine(view: RunView, kept: Kept | null): string {
  if (kept === null) {
    return FINISHED_KEPT_TEXT;
  }

  const name = view.display(kept.sensor);
  const head = `Kept ${name} ${kept.done}/${kept.total}`;

  return kept.stage === null ? head : `${head} on ${kept.stage}`;
}

export const NO_ESTIMATE_YET = "No estimate yet";

function timeLeft(
  run: Run,
  view: RunView,
): { text: string; title?: string } | null {
  if (run.startedBy !== "app") {
    return null;
  }

  const live: PluginRunView[] = run.plugins.filter(
    ({ state }) => state === "queued" || state === "running",
  );

  if (live.length === 0) {
    return null;
  }

  const silent = live.filter(({ estimateMs }) => estimateMs === null);

  if (silent.length > 0) {
    return {
      text: NO_ESTIMATE_YET,
      title: `No estimate from ${silent.map(({ name }) => view.display(name)).join(", ")}`,
    };
  }

  const total = live.reduce((sum, one) => sum + (one.estimateMs ?? 0), 0);

  return { text: `${roundedTime(total)} left` };
}

function cardOf(
  run: Run,
  view: RunView,
  ticked: ReadonlySet<string>,
  sensors: ReadonlySet<string>,
): RunCard | null {
  const time = clockText(run.endedAt ?? run.startedAt);
  const base = {
    phase: run.state,
    line: null,
    lineTitle: null,
    showLog: null,
    gaps: [],
    help: [],
    when: { text: time },
    origin: origin(run.startedBy, clockText(run.startedAt)),
  };

  switch (run.state) {
    case "checking":
      return {
        ...base,
        icon: "loader",
        tone: "run",
        head: CHECKING_HEAD,
      };
    case "refused": {
      const kept = run.gaps
        .map((gap) => ({
          gap,
          needs: gap.needs.filter((name) => ticked.has(name)),
        }))
        .filter((one) => one.needs.length > 0);

      if (kept.length === 0) {
        return null;
      }

      const named = kept
        .map((one) => sensorOf(one.gap, sensors))
        .filter((name): name is string => name !== null);

      return {
        ...base,
        icon: "circle-alert",
        tone: "warn",
        head: NOTHING_RAN_TEXT,
        line: SET_UP_LINE,
        gaps: kept.map((one) => ({
          id: one.gap.id,
          line: one.gap.line,
          where: listNames(one.needs.map(view.display)),
        })),
        help: [...new Set(named)].map((sensor) => ({
          sensor,
          text: HELP_TEXT,
          command: `recognizer help sensors ${sensor}`,
        })),
      };
    }
    case "running": {
      const left = timeLeft(run, view);

      return {
        ...base,
        icon: "loader",
        tone: "run",
        head: SCANNING_HEAD,
        line: currentLine(run, view),
        ...(left === null
          ? {}
          : {
              when: {
                text: left.text,
                ...(left.title === undefined ? {} : { title: left.title }),
              },
            }),
      };
    }
    case "finished":
      return {
        ...base,
        icon: "circle-check",
        tone: "ok",
        head: FINISHED_HEAD,
        line: measuredLine(run),
      };
    case "failed": {
      const { failure } = run;
      const showLog =
        view.progress.log === null ? null : runLogPath(view.progress.log);

      if (failure === null) {
        return {
          ...base,
          icon: "circle-x",
          tone: "bad",
          head: "Scan failed",
          line: `recognizer scan exited ${run.exit ?? 1}`,
          showLog,
        };
      }

      if (failure.sensor === WHOLE_SCAN_FAILURE) {
        const nothingBegan =
          run.ran === null && view.progress.extract === "pending";

        return {
          ...base,
          icon: "circle-x",
          tone: "bad",
          head: nothingBegan ? "Scan did not start" : "Scan failed",
          line: failure.reason,
          lineTitle: failure.reason,
          showLog,
        };
      }

      const sensor = view.display(failure.sensor);

      return {
        ...base,
        icon: "circle-x",
        tone: "bad",
        head:
          failure.suite === null
            ? `${sensor} failed`
            : `${sensor} failed on ${failure.suite}`,
        line: failure.reason,
        lineTitle: failure.reason,
        showLog,
      };
    }
    case "stopped":
      return {
        ...base,
        icon: "circle-dashed",
        tone: "muted",
        head: STOPPED_HEAD,
        line: stoppedLine(view, keptCounts(run)),
      };
  }
}

const WHOLE_SCAN_FAILURE = "scan";

function startingCard(at: number): RunCard {
  return {
    phase: "checking",
    icon: "loader",
    tone: "run",
    head: CHECKING_HEAD,
    line: null,
    lineTitle: null,
    showLog: null,
    gaps: [],
    help: [],
    when: { text: clockOfMs(at) },
    origin: origin("app", clockOfMs(at)),
  };
}

export function shownRun(view: RunView): Run | null {
  const { run } = view;

  if (run === null) {
    return null;
  }

  return !isActive(run) && run.id === view.adoptedAtOpen ? null : run;
}

export function runModel(
  view: RunView | null,
  ticked: ReadonlySet<string>,
  sensors: ReadonlySet<string>,
  now: number,
): RunModel | null {
  if (view === null) {
    return null;
  }

  if (view.starting !== null) {
    return {
      card: startingCard(view.starting.at),
      subtitle: "A scan is running.",
      active: true,
      refused: false,
      button: { label: "Stop", stop: true },
      partial: null,
    };
  }

  const run = shownRun(view);

  if (run === null) {
    return null;
  }

  const card = cardOf(run, view, ticked, sensors);

  if (card === null) {
    return null;
  }

  const active = isActive(run);
  const cli = run.startedBy === "cli";
  const kept = run.state === "stopped" ? keptCounts(run) : null;
  const endedAt = Date.parse(run.endedAt ?? run.startedAt);

  return {
    card,
    subtitle: active
      ? cli
        ? "A scan is running from the command line."
        : "A scan is running."
      : IDLE_SUBTITLE,
    active,
    refused: run.state === "refused",
    button: active
      ? { label: cli ? "Stop this scan" : "Stop", stop: true }
      : {
          label: run.state === "refused" ? AGAIN_TEXT : "Scan",
          stop: false,
        },
    partial:
      kept === null
        ? null
        : {
            sensor: kept.sensor,
            text: `${kept.done} of ${kept.total}, ${ageText(
              Number.isNaN(endedAt) ? now : endedAt,
              now,
            )}`,
          },
  };
}
