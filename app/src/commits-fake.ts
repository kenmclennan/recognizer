import {
  type BranchesReply,
  type ChangeDetailReply,
  type CommitsPort,
  type HistoryReply,
  NO_CHANGE_DETAIL,
  nullFacts,
  type PullRequestsReply,
  type RefFacts,
} from "./commits-port";

export type FakeCommits = CommitsPort & {
  history: HistoryReply | Error;
  branches: BranchesReply | Error;
  pullRequests: PullRequestsReply;
  facts: Map<string, RefFacts>;
  details: Map<string, ChangeDetailReply>;
  calls: {
    history: number;
    branches: number;
    pullRequests: number;
    facts: string[][];
    details: string[];
  };
  holds: { history: Promise<void>[]; pullRequests: Promise<void>[] };
  emitGitChanged: () => void;
  emitFocus: () => void;
};

export function fakeCommits(
  initial: {
    history?: HistoryReply | Error;
    branches?: BranchesReply | Error;
    pullRequests?: PullRequestsReply;
    facts?: RefFacts[];
    details?: Record<string, ChangeDetailReply>;
  } = {},
): FakeCommits {
  const watchers = new Set<() => void>();
  const focusers = new Set<() => void>();
  const fake: FakeCommits = {
    history: initial.history ?? { branch: null, text: "" },
    branches: initial.branches ?? { defaultRef: null, total: 0, text: "" },
    pullRequests: initial.pullRequests ?? {
      status: "ok",
      detail: "",
      text: "[]",
    },
    facts: new Map((initial.facts ?? []).map((one) => [one.ref, one])),
    details: new Map(Object.entries(initial.details ?? {})),
    calls: { history: 0, branches: 0, pullRequests: 0, facts: [], details: [] },
    holds: { history: [], pullRequests: [] },
    emitGitChanged() {
      for (const run of [...watchers]) {
        run();
      }
    },
    emitFocus() {
      for (const run of [...focusers]) {
        run();
      }
    },
    watchGit(onChange) {
      watchers.add(onChange);

      return () => void watchers.delete(onChange);
    },
    onFocus(run) {
      focusers.add(run);

      return () => void focusers.delete(run);
    },
    async listHistory() {
      fake.calls.history += 1;

      const reply = fake.history;

      await fake.holds.history.shift();

      if (reply instanceof Error) {
        throw reply;
      }

      return reply;
    },
    async listBranches() {
      fake.calls.branches += 1;

      if (fake.branches instanceof Error) {
        throw fake.branches;
      }

      return fake.branches;
    },
    async refFacts(refs) {
      fake.calls.facts.push([...refs]);

      return refs.map((ref) => fake.facts.get(ref) ?? nullFacts(ref));
    },
    async changeDetail(kind, reference) {
      const key = `${kind}:${reference}`;

      fake.calls.details.push(key);

      return fake.details.get(key) ?? NO_CHANGE_DETAIL;
    },
    async listPullRequests() {
      fake.calls.pullRequests += 1;

      const reply = fake.pullRequests;

      await fake.holds.pullRequests.shift();

      return reply;
    },
  };

  return fake;
}
