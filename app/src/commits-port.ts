import type { FileChange } from "recognizer";

export type { FileChange };

export type RefFacts = {
  ref: string;
  mergeBase: string | null;
  behind: number | null;
  ahead: number | null;
  changes: FileChange[] | null;
};

export type HistoryReply = { branch: string | null; text: string };

export type BranchesReply = {
  defaultRef: string | null;
  total: number;
  text: string;
};

export type GhStatus = "ok" | "missing" | "signed-out" | "failed";

export type PullRequestsReply = {
  status: GhStatus;
  detail: string;
  text: string;
};

export type ChangeDetailKind = "commit" | "branch" | "pr";

export type ChangeDetailReply = {
  git: string | null;
  pull: PullRequestsReply | null;
  defaultRef: string | null;
};

export const NO_CHANGE_DETAIL: ChangeDetailReply = {
  git: null,
  pull: null,
  defaultRef: null,
};

export type CommitsPort = {
  listHistory(): Promise<HistoryReply>;
  listBranches(): Promise<BranchesReply>;
  refFacts(refs: string[]): Promise<RefFacts[]>;
  listPullRequests(): Promise<PullRequestsReply>;
  changeDetail(
    kind: ChangeDetailKind,
    reference: string,
  ): Promise<ChangeDetailReply>;
  watchGit(onChange: () => void): () => void;
  onFocus(run: () => void): () => void;
};

export const inertCommits: CommitsPort = {
  listHistory: async () => ({ branch: null, text: "" }),
  listBranches: async () => ({ defaultRef: null, total: 0, text: "" }),
  refFacts: async (refs) => refs.map(nullFacts),
  listPullRequests: async () => ({ status: "ok", detail: "", text: "[]" }),
  changeDetail: async () => NO_CHANGE_DETAIL,
  watchGit: () => () => {},
  onFocus: () => () => {},
};

export function nullFacts(ref: string): RefFacts {
  return {
    ref,
    mergeBase: null,
    behind: null,
    ahead: null,
    changes: null,
  };
}
