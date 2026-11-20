import type { ScanEvent } from "@recognizer/core";
import type { Io } from "./cli.js";
import {
  type DescribeResult as CliDescribeResult,
  describeSummaryText,
  stopCauseText,
} from "./describe-modules.js";
import {
  type DescribeProjection,
  projectionText,
} from "./describe-projection.js";
import { type Gap, gapText, preflightLine } from "./gap.js";
import type { PluginEvent } from "./plugin-events.js";
import {
  type EventEntry,
  entryLine,
  phaseLine,
  pluginLine,
  startLine,
  structureLine,
  summaryLine,
} from "./scan-phases.js";

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function fileLine(event: ScanEvent): string | null {
  switch (event.type) {
    case "preflight":
      return preflightLine(
        event.state === "gaps"
          ? { state: "gaps", gaps: event.gaps as Gap[] }
          : { state: event.state },
      );
    case "phase":
      return phaseLine(event.phase, event.detail);
    case "start":
      return startLine(event.phase, event.name);
    case "plugin":
      return pluginLine(
        event.phase,
        event.name,
        event.data as unknown as PluginEvent,
      );
    case "entry":
      return entryLine(event.phase, event.entry as EventEntry);
    case "structure":
      return structureLine({
        state: event.state,
        ...(event.files === undefined ? {} : { files: event.files }),
      });
    case "projection":
      return jsonLine({
        event: "projection",
        phase: "describe",
        ...event.projection,
      });
    case "confirmation-asked":
      return jsonLine({
        event: "confirm",
        phase: "describe",
        ...event.projection,
      });
    case "confirmation-answered":
      return jsonLine({
        event: "answered",
        phase: "describe",
        describe: event.describe,
      });
    case "describing-stopped":
      return jsonLine({
        event: "stopped",
        phase: "describe",
        cause: event.stop.cause,
        reason: event.stop.reason,
        described: event.stop.described,
        not_described: event.stop.not_described.length,
        threshold: event.stop.threshold,
      });
    case "summary": {
      const { type: _type, ...summary } = event;

      return summaryLine(summary as Parameters<typeof summaryLine>[0]);
    }
    default:
      return null;
  }
}

function humanEntryText(
  event: Extract<ScanEvent, { type: "entry" }>,
): string | null {
  const { entry, phase } = event;

  if (phase === "extract") {
    return entry.outcome === "ok" && event.file !== undefined
      ? `${entry.name}: ${entry.modules} files, ${entry.edges} edges -> ${event.file}\n`
      : null;
  }

  if (phase === "describe") {
    return entry.outcome === "ok" ? `described ${entry.name}\n` : null;
  }

  return `${entry.outcome === "ok" ? "ran" : entry.outcome} ${entry.name}\n`;
}

export function printEvent(event: ScanEvent, json: boolean, io: Io): void {
  if (event.type === "notice") {
    if (!(event.humanOnly && json)) {
      io[event.stream](event.text);
    }

    return;
  }

  if (event.type === "phase-started") {
    if (!json) {
      io.stdout(`${event.phase}\n`);
    }

    return;
  }

  if (event.type === "confirmation-asked") {
    io.stdout(fileLine(event) as string);

    return;
  }

  if (event.type === "confirmation-answered") {
    return;
  }

  if (event.type === "describing-finished") {
    if (!json) {
      io.stdout(
        describeSummaryText(event.result as unknown as CliDescribeResult),
      );
    }

    return;
  }

  const line = fileLine(event);

  if (json && line !== null) {
    io.stdout(line);
  }

  if (json) {
    return;
  }

  if (event.type === "preflight" && event.state === "gaps") {
    for (const gap of event.gaps) {
      io.stderr(`${gapText(gap as Gap)}\n`);
    }
  } else if (event.type === "entry") {
    const text = humanEntryText(event);

    if (text !== null) {
      io.stdout(text);
    }
  } else if (event.type === "projection") {
    io.stdout(
      projectionText(event.projection as unknown as DescribeProjection),
    );
  } else if (event.type === "describing-stopped") {
    io.stderr(
      `stopped: ${stopCauseText(event.stop)}; ${event.stop.not_described.length} files not described\n`,
    );
  }
}
