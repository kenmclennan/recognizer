import type { ScanRunRecord } from "recognizer";
import { ageText } from "./footer-scan";
import type { IconName } from "./icons";
import { runLogPath } from "./run-log-path";
import {
  foldProgress,
  type ScanEvent,
  type ScanProgress,
} from "./scan-progress";

export type RunInput = {
  record: ScanRunRecord | null;
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
  phase: ScanRunRecord["phase"];
  icon: IconName;
  tone: RunCardTone;
  head: string;
  line: string;
  showLog: string | null;
  second: string | null;
  gaps: GapItem[];
  help: HelpLine[];
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

export function foldRunLine(
  state: ScanProgress,
  event: ScanEvent,
): ScanProgress {
  const next = foldProgress(state, event);

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

export const CHECKING_HEAD = "Checking before the scan";

export const CHECKING_LINE =
  "Making sure every ticked sensor's tools are in place.";

export const NOTHING_RAN_TEXT = "Nothing ran";

export const SET_UP_LINE = "Set these up, then scan again.";

export const HELP_TEXT = "To set this up with an agent:";

export const AGAIN_TEXT = "Check again and scan";

export const IDLE_SUBTITLE = "Pick what to measure, then scan.";

export const SCANNING_HEAD = "Scanning";

export const FINISHING_TEXT = "Finishing";

export const DESCRIPTIONS_NAME = "Descriptions";

export const KEPT_OTHERS_TEXT = "The other sensors' results were kept.";

export const KEPT_FINISHED_TEXT = "Results finished before the stop were kept.";

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

export function isActive(record: ScanRunRecord | null): boolean {
  return (
    record !== null &&
    (record.phase === "checking" || record.phase === "running")
  );
}

function sensorOf(
  gap: ScanRunRecord["gaps"][number],
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
  return by === "app"
    ? { icon: null, text: `Started here at ${time}` }
    : { icon: "terminal", text: `Started from the command line at ${time}` };
}

function listNames(names: string[]): string {
  return names.join(", ");
}

function currentLine(record: ScanRunRecord, view: RunView): string {
  const { progress, display } = view;
  const current = progress.sensing;

  if (current !== null) {
    const reported = progress.sensorProgress;

    if (reported !== null && reported.name === current) {
      return reported.step === "coverage"
        ? `${display(current)}: measuring coverage`
        : `${display(current)}: ${reported.done} of ${reported.total} functions`;
    }

    return display(current);
  }

  const describing = progress.describe;

  if (
    record.describe &&
    describing !== null &&
    describing.entries.length < describing.total
  ) {
    return `${DESCRIPTIONS_NAME}: ${describing.entries.length} of ${describing.total} modules`;
  }

  return FINISHING_TEXT;
}

function failedSensors(progress: ScanProgress): Set<string> {
  return new Set(
    (progress.sense?.entries ?? [])
      .filter((entry) => entry.outcome === "failed")
      .map((entry) => entry.name),
  );
}

function measuredLine(record: ScanRunRecord, view: RunView): string {
  const failed = failedSensors(view.progress);
  const names = [
    ...record.sensors.filter((name) => !failed.has(name)).map(view.display),
    ...(record.describe ? [DESCRIPTIONS_NAME] : []),
  ];

  return `${listNames(names)} measured.`;
}

function keptCounts(
  view: RunView,
): { sensor: string; done: number; total: number } | null {
  const { sensing, sensorProgress } = view.progress;

  if (
    sensing === null ||
    sensorProgress === null ||
    sensorProgress.name !== sensing ||
    sensorProgress.step !== "mutants"
  ) {
    return null;
  }

  return {
    sensor: sensing,
    done: sensorProgress.done,
    total: sensorProgress.total,
  };
}

function cardOf(
  record: ScanRunRecord,
  view: RunView,
  ticked: ReadonlySet<string>,
  sensors: ReadonlySet<string>,
): RunCard | null {
  const started = clockText(record.started_at);
  const ended = clockText(record.ended_at);
  const base = {
    phase: record.phase,
    showLog: null,
    second: null,
    gaps: [],
    help: [],
    origin: origin(record.started_by, started),
  };

  switch (record.phase) {
    case "checking":
      return {
        ...base,
        icon: "loader",
        tone: "run",
        head: CHECKING_HEAD,
        line: CHECKING_LINE,
      };
    case "refused": {
      const kept = record.gaps
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
    case "running":
      return {
        ...base,
        icon: "loader",
        tone: "run",
        head: SCANNING_HEAD,
        line: currentLine(record, view),
      };
    case "finished":
      return {
        ...base,
        icon: "circle-check",
        tone: "ok",
        head: `Scan finished at ${ended}`,
        line: measuredLine(record, view),
      };
    case "failed": {
      const failure = record.failure;
      const sensor = failure === null ? "" : view.display(failure.sensor);

      return {
        ...base,
        icon: "circle-x",
        tone: "bad",
        head:
          sensor === ""
            ? `Scan finished at ${ended}, failed`
            : `Scan finished at ${ended}, ${sensor} failed`,
        line: failure?.reason ?? `recognizer scan exited ${record.exit ?? 1}`,
        showLog:
          view.progress.log === null ? null : runLogPath(view.progress.log),
        second: KEPT_OTHERS_TEXT,
      };
    }
    case "stopped": {
      const kept = keptCounts(view);

      return {
        ...base,
        icon: "circle-dashed",
        tone: "muted",
        head: `Scan stopped at ${ended}`,
        line:
          kept === null
            ? KEPT_FINISHED_TEXT
            : `${view.display(kept.sensor)} kept ${kept.done} of ${kept.total} functions it had measured.`,
      };
    }
  }
}

function startingCard(at: number): RunCard {
  return {
    phase: "checking",
    icon: "loader",
    tone: "run",
    head: CHECKING_HEAD,
    line: CHECKING_LINE,
    showLog: null,
    second: null,
    gaps: [],
    help: [],
    origin: origin("app", clockOfMs(at)),
  };
}

export function shownRecord(view: RunView): ScanRunRecord | null {
  const record = view.record;

  if (record === null) {
    return null;
  }

  return !isActive(record) && record.run_id === view.adoptedAtOpen
    ? null
    : record;
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

  const record = shownRecord(view);

  if (record === null) {
    return null;
  }

  const card = cardOf(record, view, ticked, sensors);

  if (card === null) {
    return null;
  }

  const active = isActive(record);
  const cli = record.started_by === "cli";
  const kept = record.phase === "stopped" ? keptCounts(view) : null;
  const endedAt = Date.parse(record.ended_at ?? record.started_at);

  return {
    card,
    subtitle: active
      ? cli
        ? "A scan is running from the command line."
        : "A scan is running."
      : IDLE_SUBTITLE,
    active,
    refused: record.phase === "refused",
    button: active
      ? { label: cli ? "Stop this scan" : "Stop", stop: true }
      : {
          label: record.phase === "refused" ? AGAIN_TEXT : "Scan",
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
