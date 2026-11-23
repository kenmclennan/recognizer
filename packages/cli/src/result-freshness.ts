export {
  buildFreshness,
  type Freshness,
  type Measured,
  moduleOf,
  scanHashes,
} from "@recognizer/core";

import type { Finding, Freshness, SensorFindings } from "@recognizer/core";

export function namedModules(record: Finding): string[] {
  return [
    ...record.files,
    ...(record.members ?? []).map((member) => member.file),
  ];
}

export function splitFindings(
  document: SensorFindings,
  freshness: Freshness,
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
