import {
  type BranchesReply,
  type CommitsPort,
  type HistoryReply,
  nullFacts,
  type PullRequestsReply,
  type RefFacts,
} from "./commits-port";

export type FakeCommits = CommitsPort & {
  history: HistoryReply | Error;
  branches: BranchesReply | Error;
  pullRequests: PullRequestsReply;
  facts: Map<string, RefFacts>;
  calls: {
    history: number;
    branches: number;
    pullRequests: number;
    facts: string[][];
  };
};

export function fakeCommits(
  initial: {
    history?: HistoryReply | Error;
    branches?: BranchesReply | Error;
    pullRequests?: PullRequestsReply;
    facts?: RefFacts[];
  } = {},
): FakeCommits {
  const fake: FakeCommits = {
    history: initial.history ?? { branch: null, text: "" },
    branches: initial.branches ?? { defaultRef: null, total: 0, text: "" },
    pullRequests: initial.pullRequests ?? {
      status: "ok",
      detail: "",
      text: "[]",
    },
    facts: new Map((initial.facts ?? []).map((one) => [one.ref, one])),
    calls: { history: 0, branches: 0, pullRequests: 0, facts: [] },
    async listHistory() {
      fake.calls.history += 1;

      if (fake.history instanceof Error) {
        throw fake.history;
      }

      return fake.history;
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
    async listPullRequests() {
      fake.calls.pullRequests += 1;

      return fake.pullRequests;
    },
  };

  return fake;
}
