import type { RepositoryState } from "@recognizer/core";
import type { RepositoryStateHolder } from "./repository-state-holder";
import { activityOf, panelChanged } from "./repository-state-model";
import { singleFlight } from "./single-flight";

export function refreshOnChange(
  holder: Pick<RepositoryStateHolder, "onRevision">,
  refresh: () => Promise<unknown>,
): () => void {
  let rendered: RepositoryState | null = null;
  const request = singleFlight(async () => {
    await refresh();
  });

  return holder.onRevision((state) => {
    const before = rendered;

    if (activityOf(state.run, false).busy) {
      return;
    }

    rendered = state;

    if (before !== null && panelChanged(before, state)) {
      request();
    }
  });
}
