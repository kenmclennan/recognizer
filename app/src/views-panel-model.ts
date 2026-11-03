import {
  type ChangeFacts,
  rangeText,
  resolveView,
  type Scan,
  type StaleReason,
  staleReasons,
  staleReasonText,
  type View,
  viewNotes,
} from "recognizer";
import { parseViewFile } from "./view-file";

export const RECENT_LIMIT = 5;

export type ViewRow = {
  name: string;
  description: string;
  range: string | null;
  notes: number;
  reasons: string[];
};

export type InvalidRow = { name: string; problem: string };

export type ViewsPanelModel = {
  live: ViewRow[];
  stale: ViewRow[];
  invalid: InvalidRow[];
};

export type ViewEntry = { name: string; text: string };

export function rangeOf(view: View): string | null {
  return view.change === undefined ? null : rangeText(view.change);
}

export function reasonsOf(
  view: View,
  scans: Scan[],
  facts: ChangeFacts | null,
): StaleReason[] {
  return staleReasons(view, resolveView(view, scans).unresolved, facts);
}

export function viewsPanelModel(
  entries: ViewEntry[],
  scans: Scan[],
  facts: ReadonlyMap<string, ChangeFacts | null>,
): ViewsPanelModel {
  const live: ViewRow[] = [];
  const stale: ViewRow[] = [];
  const invalid: InvalidRow[] = [];

  for (const { name, text } of [...entries].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const parsed = parseViewFile(text);

    if (!parsed.ok) {
      invalid.push({ name, problem: parsed.reason });

      continue;
    }

    const { view } = parsed;
    const reasons = reasonsOf(view, scans, facts.get(name) ?? null).map(
      staleReasonText,
    );
    const row: ViewRow = {
      name,
      description: view.description,
      range: rangeOf(view),
      notes: viewNotes(view).length,
      reasons,
    };

    (reasons.length === 0 ? live : stale).push(row);
  }

  return { live, stale, invalid };
}

export function dropdownNames(
  all: string[],
  recent: string[],
  limit = RECENT_LIMIT,
): string[] {
  const known = new Set(all);
  const chosen: string[] = [];

  for (const name of [
    ...recent,
    ...[...all].sort((a, b) => a.localeCompare(b)),
  ]) {
    if (known.has(name) && !chosen.includes(name)) {
      chosen.push(name);
    }

    if (chosen.length === limit) {
      break;
    }
  }

  return chosen;
}

export function showsAllLink(total: number, limit = RECENT_LIMIT): boolean {
  return total > limit;
}
