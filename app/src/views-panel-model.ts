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
  title: string | null;
  description: string;
  meta: string | null;
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

function shortRef(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

export function metaOf(view: View): string | null {
  const parts: string[] = [];
  const notes = viewNotes(view).length;

  if (view.change !== undefined) {
    parts.push(
      `Changes ${shortRef(view.change.base)} to ${shortRef(view.change.head)}`,
    );
  }

  if (notes > 0) {
    parts.push(`${notes} ${notes === 1 ? "note" : "notes"}`);
  }

  return parts.length === 0 ? null : parts.join(" \u00b7 ");
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
      title: view.title ?? null,
      description: view.description,
      meta: metaOf(view),
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
