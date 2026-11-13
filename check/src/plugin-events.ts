import validate from "./generated/events-validator.js";

export const EVENT_PREFIX = "recognizer-event ";

export type PluginEvent =
  | { event: "start"; total: number; unit: string }
  | {
      event: "progress";
      done: number;
      total: number;
      unit: string;
      step?: string;
    }
  | { event: "note"; text: string }
  | { event: "diagnosis"; code: string; text: string; fix?: string };

export interface Diagnosis {
  code: string;
  line: string;
  suite?: string;
  fix?: string;
  failing?: { count?: number; names: string[] };
  unmeasured?: boolean;
}

export type ParsedLine =
  | { kind: "event"; event: PluginEvent }
  | { kind: "invalid" }
  | { kind: "text" };

export function parseEventLine(line: string): ParsedLine {
  if (!line.startsWith(EVENT_PREFIX)) {
    return { kind: "text" };
  }

  let value: unknown;

  try {
    value = JSON.parse(line.slice(EVENT_PREFIX.length));
  } catch {
    return { kind: "invalid" };
  }

  return validate(value)
    ? { kind: "event", event: value as PluginEvent }
    : { kind: "invalid" };
}

export interface EventReader {
  line(line: string): void;
  keep(stderr: string): string;
  diagnosis(): Diagnosis | null;
  firstWorked(): number | null;
}

export function createEventReader(
  onEvent?: (event: PluginEvent) => void,
  now: () => number = () => Date.now(),
): EventReader {
  let invalid = 0;
  let diagnosis: Diagnosis | null = null;
  let firstWorked: number | null = null;

  return {
    line: (line) => {
      const parsed = parseEventLine(line);

      if (parsed.kind === "invalid") {
        invalid += 1;

        return;
      }

      if (parsed.kind === "text") {
        return;
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

      onEvent?.(event);
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
  };
}
