import type {
  BranchRow,
  BranchTip,
  CommitDetail,
  HistoryRow,
  PullDetail,
  PullRequestRow,
} from "@recognizer/core";
import type { FileChange } from "recognizer";

export type { FileChange };

export type RefFacts = {
  ref: string;
  mergeBase: string | null;
  behind: number | null;
  ahead: number | null;
  changes: FileChange[] | null;
};

export type HistoryReply = {
  branch: string | null;
  rows: HistoryRow[];
  skipped: number;
};

export type BranchesReply = {
  defaultRef: string | null;
  total: number;
  rows: BranchRow[];
  skipped: number;
};

export type GhStatus = "ok" | "missing" | "signed-out" | "failed";

export type PullRequestsReply = {
  status: GhStatus;
  detail: string;
  rows: PullRequestRow[];
  skipped: number;
};

export type ChangeDetailKind = "commit" | "branch" | "pr";

export type PullDetailReply = {
  status: GhStatus;
  detail: string;
  pull: PullDetail | null;
};

export type ChangeDetailReply = {
  commit: CommitDetail | null;
  tip: BranchTip | null;
  pull: PullDetailReply | null;
  defaultRef: string | null;
};

export const NO_CHANGE_DETAIL: ChangeDetailReply = {
  commit: null,
  tip: null,
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
  listHistory: async () => ({ branch: null, rows: [], skipped: 0 }),
  listBranches: async () => ({
    defaultRef: null,
    total: 0,
    rows: [],
    skipped: 0,
  }),
  refFacts: async (refs) => refs.map(nullFacts),
  listPullRequests: async () => ({
    status: "ok",
    detail: "",
    rows: [],
    skipped: 0,
  }),
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
