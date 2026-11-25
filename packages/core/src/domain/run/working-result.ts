import type { RepositoryState } from "./repository-state.js";
import type { ResultEntryView } from "./result-set.js";

export function workingResult(
  state: RepositoryState,
  name: string,
): ResultEntryView | null {
  const entries = state.results[name]?.results ?? [];

  return entries.find((entry) => entry.modified) ?? entries[0] ?? null;
}

export function reportedMs(
  state: RepositoryState,
  name: string,
): number | null {
  const at = workingResult(state, name)?.reportedAt ?? null;

  if (at === null) {
    return null;
  }

  const ms = Date.parse(at);

  return Number.isNaN(ms) ? null : ms;
}
