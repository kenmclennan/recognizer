import type { Diagnosis } from "./diagnosis.js";

export type EventValidator = (value: unknown) => boolean;

export const EVENT_PREFIX = "recognizer-event ";

export type PluginEvent =
  | {
      event: "start";
      total: number;
      unit: string;
      queued?: number;
      not_measured?: {
        reused: number;
        no_covered_site: number;
        out_of_scope: number;
      };
    }
  | {
      event: "progress";
      done: number;
      total: number;
      unit: string;
      step?: string;
    }
  | { event: "note"; text: string }
  | { event: "diagnosis"; code: string; text: string; fix?: string }
  | { event: "stage"; name: string; index: number; of: number }
  | { event: "estimate"; remaining_ms: number | null }
  | {
      event: "result";
      findings?: Record<string, unknown>[];
      overlay?: Record<string, Record<string, number | boolean>>;
    }
  | ({
      event: "settled";
      modified: boolean;
      settings: Record<string, unknown>;
    } & Record<string, unknown>);

export type ParsedLine =
  | { kind: "event"; event: PluginEvent }
  | { kind: "invalid" }
  | { kind: "text" };

function stagePastItsTotal(value: unknown): boolean {
  const event = value as { event?: unknown; index?: unknown; of?: unknown };

  return (
    event.event === "stage" &&
    typeof event.index === "number" &&
    typeof event.of === "number" &&
    event.index > event.of
  );
}

export function parseEventLine(
  line: string,
  validate: EventValidator,
): ParsedLine {
  if (!line.startsWith(EVENT_PREFIX)) {
    return { kind: "text" };
  }

  let value: unknown;

  try {
    value = JSON.parse(line.slice(EVENT_PREFIX.length));
  } catch {
    return { kind: "invalid" };
  }

  if (!validate(value) || stagePastItsTotal(value)) {
    return { kind: "invalid" };
  }

  return { kind: "event", event: value as PluginEvent };
}

export interface EventReader {
  line(line: string): boolean;
  keep(stderr: string): string;
  diagnosis(): Diagnosis | null;
  firstWorked(): number | null;
  suites(): SuiteDuration[];
}

export interface SuiteDuration {
  name: string;
  duration_ms: number;
}

export function createEventReader(
  validate: EventValidator,
  onEvent?: (event: PluginEvent) => void,
  now: () => number = () => Date.now(),
): EventReader {
  let invalid = 0;
  let diagnosis: Diagnosis | null = null;
  let firstWorked: number | null = null;
  const staged: { name: string; at: number }[] = [];

  return {
    line: (line) => {
      const parsed = parseEventLine(line, validate);

      if (parsed.kind === "invalid") {
        invalid += 1;

        return true;
      }

      if (parsed.kind === "text") {
        return false;
      }

      const { event } = parsed;

      if (event.event === "diagnosis") {
        diagnosis = {
          code: event.code,
          line: event.text,
          ...(event.fix === undefined ? {} : { fix: event.fix }),
        };
      }

      if (event.event === "progress" && event.done > 0) {
        firstWorked ??= now();
      }

      if (event.event === "stage") {
        staged.push({ name: event.name, at: now() });
      }

      onEvent?.(event);

      return true;
    },
    keep: (stderr) => {
      const kept = stderr
        .split("\n")
        .filter((line) => !line.startsWith(EVENT_PREFIX))
        .join("\n");

      if (invalid === 0) {
        return kept;
      }

      const note = `ignored ${invalid} invalid event ${invalid === 1 ? "line" : "lines"}`;

      return kept.trim() === "" ? `${note}\n` : `${kept.trimEnd()}\n${note}\n`;
    },
    diagnosis: () => diagnosis,
    firstWorked: () => firstWorked,
    suites: () => {
      const end = now();

      return staged.map(({ name, at }, index) => ({
        name,
        duration_ms: Math.max(
          0,
          Math.round((staged[index + 1]?.at ?? end) - at),
        ),
      }));
    },
  };
}
