import { type Diagnosis, validateRunRecord } from "recognizer";
import { diagnosisOf } from "./scan-progress";

export type Refusal = { reason: string; diagnosis?: Diagnosis; at: number };

export type RunRecordFiles = {
  files: { name: string; text: string }[];
  refused: string[];
};

type Registered = { name: string; modifiedMs?: number | null };

function senseEntries(record: ReturnType<typeof validateRunRecord>) {
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

export function refusalsOf(
  files: RunRecordFiles["files"],
  registered: string[],
  statuses: Registered[],
): Record<string, Refusal> {
  const records = [...files]
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
    .flatMap((file) => {
      try {
        return [validateRunRecord(JSON.parse(file.text))];
      } catch {
        return [];
      }
    });
  const found: Record<string, Refusal> = {};

  for (const name of registered) {
    for (const record of records) {
      const entry = senseEntries(record).find((one) => one.name === name);

      if (entry === undefined) {
        continue;
      }

      if (entry.outcome === "failed") {
        const at = Date.parse(record.finished ?? record.started);
        const modifiedMs = statuses.find(
          (one) => one.name === name,
        )?.modifiedMs;
        const diagnosis = diagnosisOf(entry.diagnosis);

        if (!Number.isNaN(at) && (modifiedMs == null || at > modifiedMs)) {
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
