import type { ResolvedView, View } from "./views.js";

export type StaleReason =
  | { kind: "merged"; head: string; base: string }
  | { kind: "head-missing"; head: string }
  | { kind: "pick-unresolved"; step: number; path: string };

export interface ChangeFacts {
  headCommit: string | null;
  baseCommit: string | null;
  merged: boolean;
}

export function staleReasons(
  view: View,
  unresolved: ResolvedView["unresolved"],
  facts: ChangeFacts | null,
): StaleReason[] {
  const reasons: StaleReason[] = unresolved.map((pick) => ({
    kind: "pick-unresolved",
    step: pick.step,
    path: pick.path,
  }));

  if (facts !== null && view.change !== undefined) {
    if (facts.headCommit === null) {
      reasons.push({ kind: "head-missing", head: view.change.head });
    } else if (facts.merged) {
      reasons.push({
        kind: "merged",
        head: view.change.head,
        base: view.change.base,
      });
    }
  }

  return reasons;
}

export function staleReasonText(reason: StaleReason): string {
  switch (reason.kind) {
    case "merged":
      return `head ${reason.head} is merged into ${reason.base}`;
    case "head-missing":
      return `head ${reason.head} is not in the repository`;
    case "pick-unresolved":
      return `step ${reason.step} ${reason.path} no longer resolves`;
  }
}
