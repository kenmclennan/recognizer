import type { FindingRecord, FindingsDocument } from "./findings-document.js";

export {
  buildFreshness,
  type Freshness,
  type Measured,
  moduleOf,
  scanHashes,
} from "@recognizer/core";

import type { Freshness } from "@recognizer/core";

export function namedModules(record: FindingRecord): string[] {
  return [
    ...record.evidence.modules,
    ...(record.evidence.members ?? []).map((member) => member.module),
  ];
}

export function splitFindings(
  document: FindingsDocument,
  freshness: Freshness,
): { current: FindingRecord[]; hidden: FindingRecord[] } {
  const current: FindingRecord[] = [];
  const hidden: FindingRecord[] = [];

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
