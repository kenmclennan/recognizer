import type { Finding } from "../../domain/finding.js";
import type { SensorFindings } from "../../domain/sensor-findings.js";
import type { Freshness } from "../sensing/freshness.js";

export function namedModules(record: Finding): string[] {
  return [
    ...record.files,
    ...(record.members ?? []).map((member) => member.file),
  ];
}

export function splitFindings(
  document: SensorFindings,
  freshness: Pick<Freshness, "valid" | "current">,
): { current: Finding[]; hidden: Finding[] } {
  const current: Finding[] = [];
  const hidden: Finding[] = [];

  for (const record of document.findings) {
    const named = namedModules(record);
    const counts =
      named.length === 0
        ? freshness.valid(document)
        : named.every((module) => freshness.current(document, module));

    (counts ? current : hidden).push(record);
  }

  return { current, hidden };
}
