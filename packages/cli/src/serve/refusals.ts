import { join } from "node:path";
import { type Diagnosis, sensorsInEffect } from "@recognizer/core";
import { readDiagnosis } from "../adapters/filesystem/diagnosis-translator.js";
import type { Io } from "../cli.js";
import { validateRunRecord } from "../log-document.js";
import { manifestPorts } from "../manifest-ports.js";
import { logDirectory, type RunRecord } from "../run-log.js";

export type Refusal = { reason: string; diagnosis?: Diagnosis; at: number };

const NAME = /^\d{8}T\d{9}Z-(scan|sense)\.json$/;
const KEEP = 50;
const CAP = 2 * 1024 * 1024;

export type NamedRunFile = { name: string; record: RunRecord };

export function readRunRecordFiles(io: Io, root: string): NamedRunFile[] {
  let names: string[];

  try {
    names = io
      .readDir(logDirectory(root))
      .map((entry) => entry.name)
      .filter((name) => NAME.test(name))
      .sort()
      .reverse()
      .slice(0, KEEP);
  } catch {
    return [];
  }

  return names.flatMap((name) => {
    try {
      const text = io.readFile(join(logDirectory(root), name));

      return text.length > CAP
        ? []
        : [{ name, record: validateRunRecord(JSON.parse(text)) }];
    } catch {
      return [];
    }
  });
}

export function readRunRecords(io: Io, root: string): RunRecord[] {
  return readRunRecordFiles(io, root).map(({ record }) => record);
}

function senseEntries(record: RunRecord) {
  if (record.kind === "sense") {
    return record.entries ?? [];
  }

  if (record.kind !== "scan") {
    return [];
  }

  return (record.phases ?? [])
    .filter((phase) => phase.phase === "sense")
    .flatMap((phase) => phase.entries);
}

export function registeredNames(io: Io, _root: string): string[] {
  try {
    return sensorsInEffect(manifestPorts(io)).map(({ name }) => name);
  } catch {
    return [];
  }
}

export function refusalsOf(
  records: RunRecord[],
  registered: string[],
  modifiedMs: (name: string) => number | null,
): Record<string, Refusal> {
  const found: Record<string, Refusal> = {};

  for (const name of registered) {
    for (const record of records) {
      const entry = senseEntries(record).find((one) => one.name === name);

      if (entry === undefined) {
        continue;
      }

      if (entry.outcome === "failed") {
        const at = Date.parse(record.finished ?? record.started);
        const modified = modifiedMs(name);
        const diagnosis = readDiagnosis(entry.diagnosis);

        if (!Number.isNaN(at) && (modified == null || at > modified)) {
          found[name] = {
            reason: entry.reason ?? "failed",
            ...(diagnosis === null ? {} : { diagnosis }),
            at,
          };
        }
      }

      break;
    }
  }

  return found;
}
