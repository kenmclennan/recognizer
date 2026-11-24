import type {
  ActiveRunRead,
  ActiveRunRepository,
  MarkerFacts,
  ReadCursor,
  RunReport,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { errorText } from "../../errors.js";
import {
  endedAtFor,
  markerPath,
  parseMarker,
  processIsTheScan,
  type ScanRunRecord,
  settleKilledMarker,
} from "../../scan-marker.js";
import { appendedLines } from "../../serve/watch.js";
import { markerFactsOf, reportOfLine } from "./progress-translator.js";

export class ActiveRunAdapter implements ActiveRunRepository {
  constructor(private readonly io: Io) {}

  read(root: string, from: ReadCursor | null): ActiveRunRead {
    const path = markerPath(root);

    if (!this.io.exists(path)) {
      return { kind: "none" };
    }

    let record: ScanRunRecord | null;

    try {
      record = parseMarker(this.io.readFile(path));
    } catch (error) {
      return { kind: "unreadable", reason: errorText(error) };
    }

    if (record === null) {
      return {
        kind: "unreadable",
        reason: `${path} is not a valid scan marker`,
      };
    }

    const offset =
      from !== null && from.runId === record.run_id ? from.offset : 0;
    const tail = appendedLines(this.io, root, offset);
    const sensors = new Set(record.sensors);
    const reports: RunReport[] = [];

    for (const line of tail.lines) {
      const report = reportOfLine(line, sensors);

      if (report !== null) {
        reports.push(report);
      }
    }

    const active = record.phase === "checking" || record.phase === "running";
    const killed = active && !processIsTheScan(this.io, record);
    const kind = killed ? "killed" : active ? "live" : "ended";
    const endedAt = killed
      ? endedAtFor(this.io, root, record)
      : record.ended_at;

    return {
      kind,
      record: markerFactsOf(record, endedAt),
      reports,
      offset: tail.offset,
    };
  }

  settleKilled(root: string, record: MarkerFacts): void {
    settleKilledMarker(this.io, root, record.runId);
  }
}
