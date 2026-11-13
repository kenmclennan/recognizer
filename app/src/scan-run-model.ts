import type { ScanRunRecord } from "recognizer";
import { ageText } from "./footer-scan";
import type { IconName } from "./icons";
import { runLogPath } from "./run-log-path";
import { remaining } from "./scan-estimate";
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
  line: string | null;
  lineTitle: string | null;
  showLog: string | null;
  gaps: GapItem[];
  help: HelpLine[];
  when: { icon: IconName | null; text: string; title?: string };
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
  const { timing } = state;

  switch (event.event) {
    case "phase":
      return {
        ...next,
        timing: {
          ...timing,
          phaseAt: { ...timing.phaseAt, [event.phase]: at },
          describeFrom: event.phase === "describe" ? at : timing.describeFrom,
        },
      };
    case "answered":
      return { ...next, timing: { ...timing, describeFrom: at } };
    case "start":
      return {
        ...next,
        timing: {
          ...timing,
          sensorAt: { ...timing.sensorAt, [event.name]: at },
          rateFrom: null,
        },
      };
    case "plugin":
      return pluginTimed(next, timing, event, at);
    default:
      return next;
  }
}

function pluginTimed(
  next: ScanProgress,
  timing: ScanProgress["timing"],
  event: Extract<ScanEvent, { event: "plugin" }>,
  at: number,
): ScanProgress {
  const { data } = event;

  if (data.event === "start") {
    return { ...next, timing: { ...timing, rateFrom: null } };
  }

  if (data.event !== "progress") {
    return next;
  }

  const from = timing.rateFrom;

  return from !== null && from.unit === data.unit && from.step === data.step
    ? next
    : {
        ...next,
        timing: {
          ...timing,
          rateFrom: {
            at,
            done: data.done,
            unit: data.unit,
            ...(data.step === undefined ? {} : { step: data.step }),
          },
        },
      };
}

export function foldRunLine(
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

const REASON_LIMIT = 60;

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

function when(
  by: "cli" | "app",
  time: string,
): { icon: IconName | null; text: string } {
  return { icon: by === "cli" ? "terminal" : null, text: time };
}

function listNames(names: string[]): string {
  return names.join(", ");
}

function currentLine(record: ScanRunRecord, view: RunView): string {
  const { progress, display } = view;
  const current = progress.sensing;

  if (current !== null) {
    const reported = progress.sensorProgress;
    const name = display(current);

    const counted =
      reported !== null && reported.name === current
        ? reported.progress
        : undefined;

    if (counted !== undefined) {
      return counted.step === undefined
        ? `${name} \u00b7 ${counted.done}/${counted.total}`
        : `${name} \u00b7 ${counted.step} \u00b7 ${counted.done}/${counted.total}`;
    }

    return name;
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
  const count =
    record.sensors.filter((name) => !failed.has(name)).length +
    (record.describe ? 1 : 0);

  return `${count} ${count === 1 ? "sensor" : "sensors"} measured`;
}

type Kept = {
  sensor: string;
  suite: string | null;
  done: number;
  total: number;
};

function keptCounts(view: RunView): Kept | null {
  const { sensing, sensorProgress } = view.progress;

  if (
    sensing === null ||
    sensorProgress === null ||
    sensorProgress.name !== sensing ||
    sensorProgress.progress === undefined
  ) {
    return null;
  }

  return {
    sensor: sensing,
    suite: sensorProgress.progress.step ?? null,
    done: sensorProgress.progress.done,
    total: sensorProgress.progress.total,
  };
}

function stoppedLine(
  record: ScanRunRecord,
  view: RunView,
  kept: Kept | null,
): string {
  if (kept === null) {
    return FINISHED_KEPT_TEXT;
  }

  const name = view.display(kept.sensor);
  const started = view.progress.startedSuites[kept.sensor] ?? [];
  const skipped = (record.suites[kept.sensor] ?? []).filter(
    (suite) => !started.includes(suite),
  );
  const head =
    kept.suite === null
      ? `Kept ${name} ${kept.done}/${kept.total}`
      : `Kept ${name} ${kept.done}/${kept.total} on ${kept.suite}`;

  return [head, ...skipped.map((suite) => `skipped ${name} on ${suite}`)].join(
    " \u00b7 ",
  );
}

function shortReason(failure: NonNullable<ScanRunRecord["failure"]>): string {
  return failure.reason.slice(0, REASON_LIMIT);
}

function timeLeft(
  record: ScanRunRecord,
  view: RunView,
  now: number,
): { text: string; title?: string } | null {
  if (record.started_by !== "app") {
    return null;
  }

  const startedAt = Date.parse(record.started_at);
  const left = remaining({
    parts: [
      { key: "structure", name: "Structure" },
      ...(record.describe
        ? [{ key: "describe", name: DESCRIPTIONS_NAME }]
        : []),
      ...record.sensors.map((name) => ({
        key: name,
        name: view.display(name),
      })),
    ],
    suites: record.suites,
    progress: view.progress,
    startedAt: Number.isNaN(startedAt) ? null : startedAt,
    now,
  });

  return left === null
    ? null
    : {
        text: left.text,
        ...(left.title === null ? {} : { title: left.title }),
      };
}

function cardOf(
  record: ScanRunRecord,
  view: RunView,
  ticked: ReadonlySet<string>,
  sensors: ReadonlySet<string>,
  now: number,
): RunCard | null {
  const time = clockText(record.ended_at ?? record.started_at);
  const base = {
    phase: record.phase,
    line: null,
    lineTitle: null,
    showLog: null,
    gaps: [],
    help: [],
    when: when(record.started_by, time),
  };

  switch (record.phase) {
    case "checking":
      return {
        ...base,
        icon: "loader",
        tone: "run",
        head: CHECKING_HEAD,
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
    case "running": {
      const left = timeLeft(record, view, now);

      return {
        ...base,
        icon: "loader",
        tone: "run",
        head: SCANNING_HEAD,
        line: currentLine(record, view),
        ...(left === null
          ? {}
          : {
              when: {
                icon: null,
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
        line: measuredLine(record, view),
      };
    case "failed": {
      const failure = record.failure;
      const showLog =
        view.progress.log === null ? null : runLogPath(view.progress.log);

      if (failure === null) {
        return {
          ...base,
          icon: "circle-x",
          tone: "bad",
          head: "Scan failed",
          line: `recognizer scan exited ${record.exit ?? 1}`,
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
        line: shortReason(failure),
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
        line: stoppedLine(record, view, keptCounts(view)),
      };
  }
}

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
    when: when("app", clockOfMs(at)),
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

  const card = cardOf(record, view, ticked, sensors, now);

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
