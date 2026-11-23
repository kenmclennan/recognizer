export type StaleReason =
  | { kind: "merged"; head: string; base: string }
  | { kind: "head-missing"; head: string }
  | { kind: "pick-unresolved"; step: number; path: string };

export interface ChangeFacts {
  headCommit: string | null;
  baseCommit: string | null;
  merged: boolean;
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
